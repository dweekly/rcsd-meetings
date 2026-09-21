# Catálogo de datos y guía para agentes

Datos JSON públicos para investigar el Distrito Escolar de Redwood City. Este es un proyecto comunitario independiente, no el sitio oficial del distrito. No se requiere cuenta ni clave de API.

Elija el conjunto de datos más pequeño que responda a su pregunta. Cite la fuente oficial y el año de los datos. Las fechas de verificación provienen de los archivos; si faltan, la actualidad es desconocida. Los resúmenes, traducciones y transcripciones automáticos pueden contener errores. Las celdas suprimidas no son cero.

- [Catálogo legible por máquinas](https://rcsd.info/catalog.json)
- [Guía para agentes (inglés)](https://rcsd.info/.well-known/agent-skills/rcsd-data-web/SKILL.md)
- [Esquema de campos (inglés)](https://rcsd.info/agents/data-schema.md)
- [Conectar un cliente MCP](https://rcsd.info/mcp/es/)

## Ejemplo: buscar una escuela

Descargue schools.json, identifique el código de escuela o CDS y seleccione la misma escuela y año en los datos SARC o CDE. Para documentos de la mesa directiva, empiece por attachment-index.json; document-index.json solo contiene documentos clasificados.

```sh
curl -fsS https://data.rcsd.info/json/schools.json
```

## Directorio de escuelas

- [schools.json](https://data.rcsd.info/json/schools.json)

## Escuelas chárter autorizadas por el distrito

- [charters.json](https://data.rcsd.info/json/charters.json)

## Propiedades y arrendamientos del distrito

- [properties.json](https://data.rcsd.info/json/properties.json)

## Mesa directiva y liderazgo del distrito

- [trustees.json](https://data.rcsd.info/json/trustees.json)
- [freshness.json](https://data.rcsd.info/json/freshness.json)

## Calendarios escolares

- [district-calendar-2025-26.json](https://data.rcsd.info/json/district-calendar-2025-26.json)
- [district-calendar-2026-27.json](https://data.rcsd.info/json/district-calendar-2026-27.json)

## Temas previstos para la mesa directiva

- [governance-calendar.json](https://data.rcsd.info/json/governance-calendar.json)

## Reuniones, agendas y documentos de la mesa directiva

- [meetings-data.json](https://data.rcsd.info/json/meetings-data.json)
- [attachment-index.json](https://data.rcsd.info/json/attachment-index.json)
- [document-index.json](https://data.rcsd.info/json/document-index.json)

## Resúmenes de reuniones y traducciones generados con IA

- [meeting-summaries.json](https://data.rcsd.info/json/meeting-summaries.json)
- [meeting-summaries-es.json](https://data.rcsd.info/json/meeting-summaries-es.json)
- [school-board-summaries.json](https://data.rcsd.info/json/school-board-summaries.json)

## Grabaciones y marcas de tiempo de las agendas

- [youtube-index.json](https://data.rcsd.info/json/youtube-index.json)
- [timestamp-map.json](https://data.rcsd.info/json/timestamp-map.json)

## Índice de políticas y resúmenes con IA; consulte cada política según sea necesario

- [policies-index.json](https://data.rcsd.info/json/policies-index.json)
- [policy-summaries.json](https://data.rcsd.info/json/policy-summaries.json)
- [policy-titles-es.json](https://data.rcsd.info/json/policy-titles-es.json)

## Matrícula de educación especial y categorías de discapacidad

- [sped-enrollment.json](https://data.rcsd.info/json/sped-enrollment.json)
- [sped-categories.json](https://data.rcsd.info/json/sped-categories.json)

## Informes de responsabilidad escolar: resultados, demografía y gastos

- [sarc/adelante-selby.json](https://data.rcsd.info/json/sarc/adelante-selby.json)
- [sarc/clifford.json](https://data.rcsd.info/json/sarc/clifford.json)
- [sarc/garfield.json](https://data.rcsd.info/json/sarc/garfield.json)
- [sarc/henry-ford.json](https://data.rcsd.info/json/sarc/henry-ford.json)
- [sarc/hoover.json](https://data.rcsd.info/json/sarc/hoover.json)
- [sarc/kennedy.json](https://data.rcsd.info/json/sarc/kennedy.json)
- [sarc/mckinley-mit.json](https://data.rcsd.info/json/sarc/mckinley-mit.json)
- [sarc/north-star.json](https://data.rcsd.info/json/sarc/north-star.json)
- [sarc/orion.json](https://data.rcsd.info/json/sarc/orion.json)
- [sarc/roosevelt.json](https://data.rcsd.info/json/sarc/roosevelt.json)
- [sarc/roy-cloud.json](https://data.rcsd.info/json/sarc/roy-cloud.json)
- [sarc/sarc-summary.json](https://data.rcsd.info/json/sarc/sarc-summary.json)
- [sarc/taft.json](https://data.rcsd.info/json/sarc/taft.json)

## Datos estatales: ausentismo, estudiantes de inglés y personal

- [cde/absenteeism-2024-25.json](https://data.rcsd.info/json/cde/absenteeism-2024-25.json)
- [cde/ltel-2024-25.json](https://data.rcsd.info/json/cde/ltel-2024-25.json)
- [cde/staff-ethnicity-2024-25.json](https://data.rcsd.info/json/cde/staff-ethnicity-2024-25.json)
- [cde/staff-experience-2024-25.json](https://data.rcsd.info/json/cde/staff-experience-2024-25.json)
- [cde/staff-ratios-2024-25.json](https://data.rcsd.info/json/cde/staff-ratios-2024-25.json)

## Presupuestos de planes escolares y consejos escolares

- [spsa-budgets.json](https://data.rcsd.info/json/spsa-budgets.json)
- [ssc-membership.json](https://data.rcsd.info/json/ssc-membership.json)
- [ssc-meetings.json](https://data.rcsd.info/json/ssc-meetings.json)

## Presentaciones escolares y menciones de clubes extraídas con IA

- [site-presentations.json](https://data.rcsd.info/json/site-presentations.json)
- [school-clubs.json](https://data.rcsd.info/json/school-clubs.json)

## Miembros y reuniones de comités

- [committees/cboc.json](https://data.rcsd.info/json/committees/cboc.json)
- [committees/delac.json](https://data.rcsd.info/json/committees/delac.json)

## Cobertura de pagos y alias de proveedores; consulte los registros mensuales según sea necesario

- [warrants-index.json](https://data.rcsd.info/json/warrants-index.json)
- [warrant-vendor-aliases.json](https://data.rcsd.info/json/warrant-vendor-aliases.json)
- [warrant-pdf-manifest.json](https://data.rcsd.info/json/warrant-pdf-manifest.json)
