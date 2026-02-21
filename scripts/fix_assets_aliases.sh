#!/usr/bin/env bash
set -euo pipefail

# =========================================================
# fix_assets_aliases.sh (PRO VERSION)
# - Crea aliases sin espacios para assets (copias reales)
# - Actualiza data/catalog.json para usar los aliases
# - FIX: Prevención de Bash Bad Substitution y Command Injection
#
# Uso:
#   bash scripts/fix_assets_aliases.sh                 # crea aliases + actualiza catalog.json
#   bash scripts/fix_assets_aliases.sh --dry-run       # solo muestra qué haría
#   bash scripts/fix_assets_aliases.sh --no-catalog    # crea aliases, NO toca catalog.json
# =========================================================

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

# Exportamos las variables para que Python las lea de forma segura
export ASSETS_DIR="assets"
export CATALOG_JSON="data/catalog.json"
export REPORT_JSON="scripts/assets_aliases_report.json"
export ROOT_DIR

export DRY_RUN="0"
export UPDATE_CATALOG="1"

for arg in "$@"; do
  case "$arg" in
    --dry-run) export DRY_RUN="1" ;;
    --no-catalog) export UPDATE_CATALOG="0" ;;
    *) echo "Unknown arg: $arg" >&2; exit 1 ;;
  esac
done

if [[ ! -d "$ASSETS_DIR" ]]; then
  echo "ERROR: No existe '$ASSETS_DIR' en el root del repo." >&2
  exit 1
fi

mkdir -p scripts

# El uso de 'PY' entre comillas simples previene la evaluación de variables bash dentro del código Python
python3 - << 'PY'
import os, re, json, shutil, datetime, sys

ROOT = os.environ.get("ROOT_DIR")
ASSETS = os.path.join(ROOT, os.environ.get("ASSETS_DIR"))
CATALOG = os.path.join(ROOT, os.environ.get("CATALOG_JSON"))
REPORT = os.path.join(ROOT, os.environ.get("REPORT_JSON"))
DRY_RUN = os.environ.get("DRY_RUN") == "1"
UPDATE_CATALOG = os.environ.get("UPDATE_CATALOG") == "1"

def norm_name(name: str) -> str:
    # 1) trim
    s = name.strip()
    # 2) espacios -> guion
    s = re.sub(r"\s+", "-", s)
    # 3) colapsa guiones repetidos
    s = re.sub(r"-{2,}", "-", s)
    return s

def relpath(p: str) -> str:
    rp = os.path.relpath(p, ROOT).replace("\\", "/")
    return rp

mappings = []  # {from, to}
created = 0

# Escanea TODO assets
for dirpath, _, filenames in os.walk(ASSETS):
    for fn in filenames:
        if " " not in fn:
            continue

        src = os.path.join(dirpath, fn)
        alias_fn = norm_name(fn)
        if alias_fn == fn:
            continue

        dst = os.path.join(dirpath, alias_fn)

        frm = relpath(src)
        to = relpath(dst)

        mappings.append({"from": frm, "to": to})

        if os.path.exists(dst):
            continue

        if DRY_RUN:
            continue

        # Copia real (no symlink) para que Netlify lo sirva sí o sí sin fallos de ruteo
        shutil.copy2(src, dst)
        created += 1

# Reporte
report = {
    "generated_at": datetime.datetime.now(datetime.timezone.utc).isoformat().replace("+00:00", "Z"),
    "dry_run": DRY_RUN,
    "assets_dir": relpath(ASSETS),
    "created_alias_files": created,
    "mappings": mappings,
}
if not DRY_RUN:
    with open(REPORT, "w", encoding="utf-8") as f:
        json.dump(report, f, ensure_ascii=False, indent=2)

replacements = 0

def replace_in_obj(obj):
    global replacements
    if isinstance(obj, dict):
        return {k: replace_in_obj(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [replace_in_obj(v) for v in obj]
    if isinstance(obj, str):
        # reemplazo exacto de rutas del catálogo
        for m in mappings:
            if obj == m["from"]:
                replacements += 1
                return m["to"]
        return obj
    return obj

if UPDATE_CATALOG:
    if not os.path.exists(CATALOG):
        print(f"WARNING: No existe {relpath(CATALOG)}. Se omitió update de catálogo.", file=sys.stderr)
    else:
        try:
            with open(CATALOG, "r", encoding="utf-8") as f:
                data = json.load(f)
            new_data = replace_in_obj(data)
            if not DRY_RUN and replacements > 0:
                with open(CATALOG, "w", encoding="utf-8") as f:
                    json.dump(new_data, f, ensure_ascii=False, indent=2)
        except Exception as e:
            print("ERROR: No pude leer/actualizar catalog.json:", e, file=sys.stderr)
            sys.exit(1)

print("OK: Auditoría de assets terminada")
print(f"- Aliases de imágenes creados: {created}" + (" (dry-run)" if DRY_RUN else ""))
print(f"- Mappings encontrados que requerían corrección: {len(mappings)}")
print(f"- Reemplazos exactos en catalog.json: {replacements}" if UPDATE_CATALOG else "- catalog.json: no tocado (--no-catalog)")
print(f"- Reporte de auditoría guardado en: {relpath(REPORT)}" if not DRY_RUN else "- Reporte: (dry-run, no escrito)")
PY

echo ""
echo "PROCESO COMPLETADO EXITOSAMENTE."
echo "Tip: Revisa el reporte log en scripts/assets_aliases_report.json"
