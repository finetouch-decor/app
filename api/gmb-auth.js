module.exports = function handler(req, res) {
  const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
  const REDIRECT  = 'https://app-one-amber-58.vercel.app/api/gmb-callback';
  const scope     = 'https://www.googleapis.com/auth/business.manage';
  const url = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${CLIENT_ID}&redirect_uri=${encodeURIComponent(REDIRECT)}&response_type=code&scope=${encodeURIComponent(scope)}&access_type=offline&prompt=consent`;
  res.redirect(302, url);
};
