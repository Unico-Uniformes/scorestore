
// api/health_check.js

module.exports = (req, res) => {
  const checks = {
    STRIPE_SECRET_KEY: {
      status: process.env.STRIPE_SECRET_KEY ? '✅ Encontrada' : '❌ FALTANTE',
      description: 'Obligatoria para procesar pagos.',
    },
    SUPABASE_URL: {
      status: process.env.SUPABASE_URL ? '✅ Encontrada' : '❌ FALTANTE',
      description: 'Obligatoria para conectar a la base de datos de productos.',
    },
    SUPABASE_SERVICE_ROLE_KEY: {
      status: process.env.SUPABASE_SERVICE_ROLE_KEY ? '✅ Encontrada' : '❌ FALTANTE',
      description: 'Obligatoria para autenticarse con la base de datos.',
    },
    ENVIA_API_KEY: {
      status: process.env.ENVIA_API_KEY ? '✅ Encontrada' : '❌ FALTANTE',
      description: 'Obligatoria para cotizar envíos.',
    },
    SITE_URL: {
      status: process.env.SITE_URL ? '✅ Encontrada' : '⚠️ RECOMENDADA',
      description: 'Recomendada para que Stripe redirija correctamente.',
    },
  };

  const allGood = Object.values(checks).every(
    (check) => check.status.startsWith('✅') || check.status.startsWith('⚠️')
  );

  const summary = allGood
    ? 'Todas las variables de entorno críticas están configuradas.'
    : 'Faltan una o más variables de entorno críticas. La API no puede funcionar.';

  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  res.status(200).json({
    ok: true,
    summary,
    health_report: checks,
  });
};
