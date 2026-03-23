{
  "version": 2,
  "builds": [
    { "src": "index.html", "use": "@vercel/static" },
    { "src": "api/**.js", "use": "@vercel/node", "config": { "nodeVersion": "20.x" } }
  ],
  "routes": [
    { "src": "/api/(.*)", "dest": "api/$1.js" },
    { "src": "/success\\.html", "dest": "/success.html" },
    { "src": "/cancel\\.html", "dest": "/cancel.html" },
    { "src": "/legal\\.html", "dest": "/legal.html" },
    { "src": "/css/(.*)", "dest": "/css/$1" },
    { "src": "/js/(.*)", "dest": "/js/$1" },
    { "src": "/assets/(.*)", "dest": "/assets/$1" },
    { "src": "/data/(.*)", "dest": "/data/$1" },
    { "src": "/(.*)", "dest": "/index.html" }
  ],
  "headers": [
    { "source": "/api/(.*)", "headers": [{ "key": "Cache-Control", "value": "no-store" }] },
    { "source": "/static/(.*)", "headers": [{ "key": "Cache-Control", "value": "public, max-age=31536000" }] }
  ]
}