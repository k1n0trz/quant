function oauthPreparationSummary() {
  return {
    provider: 'google',
    planned: true,
    requiredEnv: [
      'GOOGLE_CLIENT_ID',
      'GOOGLE_CLIENT_SECRET',
      'GOOGLE_CALLBACK_URL'
    ],
    futureUserFields: [
      'provider',
      'providerUserId',
      'avatarUrl',
      'lastLoginAt'
    ],
    protectedRouteStrategy: 'session-or-jwt-middleware'
  };
}

module.exports = {
  oauthPreparationSummary
};
