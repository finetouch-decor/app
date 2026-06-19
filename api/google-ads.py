"""
Vercel Serverless Function (Python) — Google Ads API proxy seguro
Credenciais APENAS em variáveis de ambiente do Vercel
"""
import os, json
from http.server import BaseHTTPRequestHandler
from google.ads.googleads.client import GoogleAdsClient

ALLOWED_ORIGINS = [
    'https://app-one-amber-58.vercel.app',
    'http://localhost:3000',
]

PERIOD_MAP = {
    '7':  'LAST_7_DAYS',
    '30': 'LAST_30_DAYS',
    '90': 'LAST_90_DAYS',
}

class handler(BaseHTTPRequestHandler):

    def do_GET(self):
        origin = self.headers.get('Origin', '')

        # CORS — só domínios autorizados
        if origin and origin not in ALLOWED_ORIGINS:
            self._send(403, {'error': 'Forbidden'}, origin)
            return

        # Pegar parâmetro ?period=
        from urllib.parse import urlparse, parse_qs
        qs = parse_qs(urlparse(self.path).query)
        period = qs.get('period', ['30'])[0]
        gaql_period = PERIOD_MAP.get(period, 'LAST_30_DAYS')

        # Credenciais via env vars
        developer_token  = os.environ.get('GOOGLE_ADS_DEVELOPER_TOKEN', '')
        client_id        = os.environ.get('GOOGLE_ADS_CLIENT_ID', '')
        client_secret    = os.environ.get('GOOGLE_ADS_CLIENT_SECRET', '')
        refresh_token    = os.environ.get('GOOGLE_ADS_REFRESH_TOKEN', '')
        customer_id      = os.environ.get('GOOGLE_ADS_CUSTOMER_ID', '')

        if not refresh_token or not developer_token:
            self._send(500, {'error': 'Credentials not configured'}, origin)
            return

        try:
            config = {
                'developer_token': developer_token,
                'client_id': client_id,
                'client_secret': client_secret,
                'refresh_token': refresh_token,
                'login_customer_id': customer_id,
                'use_proto_plus': True,
            }
            client = GoogleAdsClient.load_from_dict(config)
            service = client.get_service('GoogleAdsService')

            # Dados diários
            daily_q = f"""
                SELECT segments.date, metrics.clicks, metrics.impressions,
                       metrics.cost_micros, metrics.ctr, metrics.average_cpc
                FROM campaign
                WHERE segments.date DURING {gaql_period}
                  AND campaign.status = 'ENABLED'
                ORDER BY segments.date ASC
            """
            daily = []
            for row in service.search(customer_id=customer_id, query=daily_q):
                daily.append({
                    'date': row.segments.date,
                    'clicks': row.metrics.clicks,
                    'impressions': row.metrics.impressions,
                    'cost': round(row.metrics.cost_micros / 1_000_000, 2),
                    'ctr': round(row.metrics.ctr * 100, 2),
                    'cpc': round(row.metrics.average_cpc / 1_000_000, 2),
                })

            # Keywords
            kw_q = f"""
                SELECT ad_group_criterion.keyword.text, ad_group_criterion.keyword.match_type,
                       metrics.clicks, metrics.impressions, metrics.cost_micros,
                       metrics.ctr, metrics.average_cpc, metrics.conversions
                FROM keyword_view
                WHERE segments.date DURING {gaql_period}
                  AND campaign.status = 'ENABLED'
                ORDER BY metrics.clicks DESC
                LIMIT 20
            """
            keywords = []
            for row in service.search(customer_id=customer_id, query=kw_q):
                keywords.append({
                    'text': row.ad_group_criterion.keyword.text,
                    'matchType': row.ad_group_criterion.keyword.match_type.name,
                    'clicks': row.metrics.clicks,
                    'impressions': row.metrics.impressions,
                    'cost': round(row.metrics.cost_micros / 1_000_000, 2),
                    'ctr': round(row.metrics.ctr * 100, 2),
                    'cpc': round(row.metrics.average_cpc / 1_000_000, 2),
                    'conversions': row.metrics.conversions,
                })

            from datetime import datetime, timezone
            self._send(200, {
                'ok': True,
                'period': gaql_period,
                'fetchedAt': datetime.now(timezone.utc).isoformat(),
                'daily': daily,
                'keywords': keywords,
            }, origin)

        except Exception as e:
            print(f'Google Ads error: {e}')
            self._send(500, {'error': 'Internal server error'}, origin)

    def _send(self, status, data, origin=''):
        body = json.dumps(data).encode()
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Cache-Control', 's-maxage=300, stale-while-revalidate=600')
        if origin in ALLOWED_ORIGINS:
            self.send_header('Access-Control-Allow-Origin', origin)
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *args):
        pass
