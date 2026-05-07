function resolveUiEntry(urlLike = {}) {
  const pathname = String(urlLike.pathname || '/');
  const searchParams = urlLike.searchParams || new URLSearchParams();
  const requestedUi = String(searchParams.get('ui') || '').trim().toLowerCase();

  if (pathname === '/login') {
    return { root: 'public', file: 'login.html', mode: 'login' };
  }

  if (pathname === '/lite' || pathname === '/lite/' || requestedUi === 'lite') {
    return { root: 'public', file: 'index.html', mode: 'lite' };
  }

  if (pathname === '/' || pathname === '/index.html' || requestedUi === 'full') {
    return { root: 'src', file: 'index.html', mode: 'full' };
  }

  return {
    root: 'auto',
    file: pathname.replace(/^\//, ''),
    mode: 'asset'
  };
}

module.exports = {
  resolveUiEntry
};
