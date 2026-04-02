#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const root = process.cwd();

const requiredFiles = [
  "index.html",
  "success.html",
  "cancel.html",
  "legal.html",
  "robots.txt",
  "sitemap.xml",
  "sw.js",
  "css/styles.css",
  "css/override.css",
  "js/main.js",
  "js/success.js",
  "site.webmanifest",
];

const requiredManifestHref = '/site.webmanifest';
const requiredSwMarker = '"/site.webmanifest"';

function fail(message) {
  console.error(`ERROR: ${message}`);
  process.exit(1);
}

function read(file) {
  return fs.readFileSync(path.join(root, file), "utf8");
}

for (const file of requiredFiles) {
  const abs = path.join(root, file);
  if (!fs.existsSync(abs)) {
    fail(`Falta el archivo requerido: ${file}`);
  }
}

const htmlFiles = ["index.html", "success.html", "cancel.html", "legal.html"];

for (const file of htmlFiles) {
  const html = read(file);
  if (!html.includes(requiredManifestHref)) {
    fail(`El archivo ${file} no apunta a /site.webmanifest`);
  }
  if (!html.includes("canonical")) {
    fail(`El archivo ${file} no tiene canonical`);
  }
  if (!html.includes("meta name=\"description\"")) {
    fail(`El archivo ${file} no tiene meta description`);
  }
}

const sw = read("sw.js");
if (!sw.includes(requiredSwMarker)) {
  fail("sw.js no precachea /site.webmanifest");
}

const robots = read("robots.txt");
if (!/Sitemap:\s+https:\/\/scorestore\.vercel\.app\/sitemap\.xml/i.test(robots)) {
  fail("robots.txt no declara el sitemap esperado");
}

const sitemap = read("sitemap.xml");
if (!sitemap.includes("https://scorestore.vercel.app/")) {
  fail("sitemap.xml no referencia el dominio esperado");
}

console.log("OK: estructura estática validada.");