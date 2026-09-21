// Public research entry points, not a crawl of caches or intermediate outputs.
// Directory families expand at build time; indexed large corpora stay on demand.
export const DATASETS = [
  ['schools', 'School directory', 'Directorio de escuelas', ['schools.json']],
  ['charters', 'District-authorized charter schools', 'Escuelas chárter autorizadas por el distrito', ['charters.json']],
  ['properties', 'District property and leases', 'Propiedades y arrendamientos del distrito', ['properties.json']],
  ['leadership', 'Trustees and district leadership', 'Mesa directiva y liderazgo del distrito', ['trustees.json', 'freshness.json']],
  ['calendars', 'School calendars', 'Calendarios escolares', ['district-calendar-*.json']],
  ['governance', 'Planned board agenda topics', 'Temas previstos para la mesa directiva', ['governance-calendar.json']],
  ['meetings', 'Board meetings, agendas and attachments', 'Reuniones, agendas y documentos de la mesa directiva', ['meetings-data.json', 'attachment-index.json', 'document-index.json']],
  ['summaries', 'AI-generated meeting summaries and translations', 'Resúmenes de reuniones y traducciones generados con IA', ['meeting-summaries.json', 'meeting-summaries-es.json', 'school-board-summaries.json']],
  ['recordings', 'Meeting recordings and agenda timestamps', 'Grabaciones y marcas de tiempo de las agendas', ['youtube-index.json', 'timestamp-map.json']],
  ['policies', 'Board policy index and AI summaries; fetch individual policies on demand', 'Índice de políticas y resúmenes con IA; consulte cada política según sea necesario', ['policies-index.json', 'policy-summaries.json', 'policy-titles-es.json']],
  ['special-education', 'Special education enrollment and disability categories', 'Matrícula de educación especial y categorías de discapacidad', ['sped-enrollment.json', 'sped-categories.json']],
  ['sarc', 'School accountability reports: academics, demographics and spending', 'Informes de responsabilidad escolar: resultados, demografía y gastos', ['sarc/*.json']],
  ['cde', 'State education data: absenteeism, English learners and staffing', 'Datos estatales: ausentismo, estudiantes de inglés y personal', ['cde/*.json']],
  ['school-plans', 'School plan budgets and site councils', 'Presupuestos de planes escolares y consejos escolares', ['spsa-budgets.json', 'ssc-membership.json', 'ssc-meetings.json']],
  ['school-presentations', 'School presentations and AI-extracted club mentions', 'Presentaciones escolares y menciones de clubes extraídas con IA', ['site-presentations.json', 'school-clubs.json']],
  ['committees', 'Committee membership and meetings', 'Miembros y reuniones de comités', ['committees/*.json']],
  ['vendor-payments', 'Vendor payment coverage and aliases; fetch monthly registers on demand', 'Cobertura de pagos y alias de proveedores; consulte los registros mensuales según sea necesario', ['warrants-index.json', 'warrant-vendor-aliases.json', 'warrant-pdf-manifest.json']],
];
