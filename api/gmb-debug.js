module.exports = async function handler(req, res) {
  const id = process.env.GOOGLE_CLIENT_ID || '';
  const secret = process.env.GOOGLE_CLIENT_SECRET || '';
  const token = process.env.GMB_REFRESH_TOKEN || '';
  return res.status(200).json({
    client_id_prefix: id.slice(0, 20),
    client_id_len: id.length,
    secret_prefix: secret.slice(0, 10),
    secret_len: secret.length,
    token_prefix: token.slice(0, 20),
    token_len: token.length,
  });
};
