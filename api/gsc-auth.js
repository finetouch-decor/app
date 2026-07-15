module.exports = function handler(req, res) {
  const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
  // Reaproveita o redirect URI do fluxo do GMB (já cadastrado no Google Cloud OAuth client)
  // em vez de cadastrar um novo -- api/gmb-callback.js identifica o fluxo pelo state=gsc.
  const REDIRECT  = 'https://app-one-amber-58.vercel.app/api/gmb-callback';
  const scope     = 'https://www.googleapis.com/auth/webmasters.readonly';
  const url = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${CLIENT_ID}&redirect_uri=${encodeURIComponent(REDIRECT)}&response_type=code&scope=${encodeURIComponent(scope)}&access_type=offline&prompt=consent&state=gsc`;
  res.redirect(302, url);
};
