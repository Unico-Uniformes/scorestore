const isSafeToCache = (requestUrl) => {
  const url = new URL(requestUrl, self.location.origin);
  if (url.origin !== self.location.origin) return false;
  
  // NO cachear datos dinámicos
  if (url.pathname.startsWith("/data/")) return false;
  if (url.pathname.startsWith("/api/")) return false;
  if (url.pathname.endsWith(".json")) return false;
  
  return true;
};