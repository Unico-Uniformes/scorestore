#!/bin/bash
echo "🤖 Agente de Sincronización Activado en scorestore..."
while inotifywait -r -e modify,create,delete,move ~/scorestore; do
    echo "¡Cambio detectado! Subiendo a GitHub..."
    git -C ~/scorestore add .
    git -C ~/scorestore commit -m "Cambio automático desde el celular"
    git -C ~/scorestore push origin main
    echo "✅ ¡Cambios sincronizados con GitHub correctamente!"
done
