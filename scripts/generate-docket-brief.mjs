#!/usr/bin/env node
/**
 * Generate and validate bilingual (EN/ES) Pre-Meeting Packet Digests & Consent
 * Calendar Screenings (`data/docket-briefs/{date}.json` + `data/docket-briefs/index.json`).
 *
 * Combines:
 *   1. Official board memos (`data/board-memos/{date}.json`, `data/board-memos-es/{date}.json`)
 *   2. Time-weighted agenda ranking (`scripts/lib/agenda-weight.mjs`)
 *   3. Automated 100% Consent Calendar screening (`scripts/lib/docket-brief.mjs`)
 *   4. Verified packet-triage synthesis (`data/triage/{date}.md`) with explicit
 *      baseline context (census date, fiscal period, certification status) and
 *      scanned-PDF / external-link disclosures.
 */

import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  attachmentInventory,
  enrichCitationArtifacts,
  R2_BASE,
  screenConsentCalendar,
  validateDocketBrief,
} from './lib/docket-brief.mjs';
import { hashFile, validateDatasetProvenance } from './lib/provenance.mjs';
import { validateJsonSchema } from './lib/provenance-schema.mjs';
import { buildAidToR2Path } from './meeting-utils.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = resolve(__dirname, '..');

// When the curated content below was last checked against the packet sources.
const REVIEWED_AT = '2026-11-02T00:00:00Z';

const meetingsData = JSON.parse(readFileSync(resolve(ROOT, 'data/meetings-data.json'), 'utf-8'));
const aidToR2Path = buildAidToR2Path(resolve(ROOT, 'data/board-memos'));

function getMeetingByDate(date) {
  return meetingsData.meetings.find((m) => m.date === date) || null;
}

function getMemoByDate(date, lang = 'en') {
  const dir = lang === 'es' ? 'data/board-memos-es' : 'data/board-memos';
  const p = resolve(ROOT, dir, `${date}.json`);
  if (!existsSync(p)) return null;
  return JSON.parse(readFileSync(p, 'utf-8'));
}

/**
 * Reviewed, packet-verified digests for key 2026-27 meetings grounded in
 * `data/triage/{date}.md` and `data/board-memos/{date}.json`.
 */
const REVIEWED_BRIEFS = {
  '2026-10-28': {
    date: '2026-10-28',
    meetingSlug: '2026-10-28-regular',
    meetingStage: 'proposed',
    qualityState: 'human-reviewed',
    overviewEn:
      'Two staff reports anchor this Regular meeting: a 40-minute Human Resources & Staffing Levels discussion carrying the district’s preliminary 2026-27 Census Day enrollment count (6,399 non-charter students, +90 over 2025-26 and +160 above the 6,239 the adopted budget assumed), and a 35-minute Integrated/Designated English Language Development (ELD) report covering 1,876 English learners. The bond and general consent calendars carry about $3.98M across seven items of $50K or more (expanded-learning and tutoring contracts, KIPP Excelencia’s Measure U allocation, supplemental buses, tree care, and bond HVAC fees), plus 11 Board Policy revisions.',
    overviewEs:
      'Dos informes del personal encabezan esta reunión ordinaria: una discusión de 40 minutos sobre Recursos Humanos y Niveles de Personal que presenta el conteo preliminar del Día del Censo 2026-27 del distrito (6,399 estudiantes en escuelas no chárter, +90 respecto a 2025-26 y +160 por encima de los 6,239 que suponía el presupuesto adoptado), y un informe de 35 minutos sobre el Desarrollo del Idioma Inglés (ELD) Integrado y Designado que abarca a 1,876 estudiantes aprendices de inglés. Los calendarios de consentimiento del bono y general suman unos $3.98 millones en siete puntos de $50K o más (contratos de aprendizaje extendido y tutoría, la asignación de la Medida U de KIPP Excelencia, autobuses suplementarios, cuidado de árboles y tarifas de HVAC del bono), además de 11 revisiones de Políticas de la Junta.',
    scheduleChangesNoteEn:
      'Per the revised October 22 Schedule of Board Agenda Items (Item 15), the Connect, Rocketship, and KIPP 2025-26 unaudited actuals review letters moved from October 28 to November 4, 2026. The Schedule does not yet list the KIPP charter renewal decision; the October 14 hearing memo anticipated Board action on December 9, 2026, and the statutory 90-day deadline is December 20, 2026.',
    scheduleChangesNoteEs:
      'Según la revisión del 22 de octubre del Calendario de Temas de la Junta (Punto 15), las cartas de revisión de resultados no auditados 2025-26 de Connect, Rocketship y KIPP pasaron del 28 de octubre al 4 de noviembre de 2026. El calendario aún no incluye la decisión sobre la renovación chárter de KIPP; el memorando de la audiencia del 14 de octubre preveía la votación de la Junta el 9 de diciembre de 2026, y el plazo legal de 90 días vence el 20 de diciembre de 2026.',
    topItems: [
      {
        itemLabel: '9.1',
        titleEn: 'Human Resources and Staffing Levels Update',
        titleEs: 'Actualización sobre Recursos Humanos y Niveles de Dotación de Personal',
        actionType: 'Discussion',
        allocatedMinutes: 40,
        proposalStatusBadgeEn: 'Discussion Item — Preliminary Data (Uncertified)',
        proposalStatusBadgeEs: 'Punto de Discusión — Datos Preliminares (No Certificados)',
        whatIsProposedEn:
          'Staff presents a four-year General Fund staffing series (870.76 FTE in 2023-24 down to 785.26 FTE in 2026-27, a 9.8% reduction) alongside a preliminary, uncertified 2026-27 Census Day enrollment count of 6,399 non-charter students (412 TK and 5,987 K-8). General Fund salary and benefit totals rose from $113.53M to $123.59M budgeted in 2026-27 (excluding pending RCTA, RCAA, and CSEA collective bargaining settlements).',
        whatIsProposedEs:
          'El personal presenta una serie de cuatro años de dotación del Fondo General (de 870.76 FTE en 2023-24 a 785.26 FTE en 2026-27, una reducción del 9.8%) junto con un conteo preliminar no certificado del Día del Censo 2026-27 de 6,399 estudiantes en escuelas no chárter (412 en TK y 5,987 en K-8). Los salarios y beneficios del Fondo General pasaron de $113.53M a $123.59M presupuestados en 2026-27 (sin incluir los acuerdos laborales pendientes con RCTA, RCAA y CSEA).',
        whyItMattersEn:
          'The preliminary 6,399 enrollment count is 90 students higher than 2025-26 (6,309) and 160 students above the 6,239 assumed in the 2026-27 Adopted Budget. About two-thirds of the increase is in Transitional Kindergarten (350 → 412), with K-8 also up slightly (5,959 → 5,987). The deck notes that the pending RCTA, RCAA and CSEA settlements will be incorporated at First Interim, which the Schedule of Board Agenda Items places on December 16, 2026.',
        whyItMattersEs:
          'El conteo preliminar de 6,399 estudiantes supera en 90 alumnos al de 2025-26 (6,309) y en 160 alumnos a los 6,239 que suponía el Presupuesto Adoptado 2026-27. Cerca de dos tercios del aumento corresponden a Kínder de Transición (350 → 412), con un ligero aumento también en K-8 (5,959 → 5,987). La presentación indica que los acuerdos laborales pendientes con RCTA, RCAA y CSEA se incorporarán en el Primer Informe Interino, que el Calendario de Temas de la Junta programa para el 16 de diciembre de 2026.',
        baselineContext: {
          metricNameEn: '2026-27 Non-Charter Enrollment & General Fund FTE',
          metricNameEs: 'Matrícula No Chárter 2026-27 y Personal FTE del Fondo General',
          censusDate: 'Preliminary 2026-27 Census Day count (uncertified)',
          fiscalPeriod: 'FY 2026-27 (Adopted Budget vs. Preliminary Oct 2026)',
          certificationStatus: 'preliminary-uncertified',
          priorBaselineNoteEn:
            'Compared against the HR deck’s own 2025-26 count of 6,309 students and the 6,239 enrollment assumed in the 2026-27 Adopted Budget (budget book p. 9). Note: Item 8.1 (ELD deck) cites a 2025-26 total of 6,276 students.',
          priorBaselineNoteEs:
            'Comparado con el conteo 2025-26 de 6,309 estudiantes de la propia presentación de RR. HH. y con la matrícula de 6,239 que supone el Presupuesto Adoptado 2026-27 (libro del presupuesto, p. 9). Nota: El Punto 8.1 (presentación ELD) cita un total de 6,276 estudiantes para 2025-26.',
        },
        citations: [
          {
            labelEn: 'HR and Staffing Levels Update Deck (Slides 1–18)',
            labelEs: 'Presentación de Recursos Humanos y Niveles de Personal (Diapositivas 1–18)',
            filename: 'Final-RCSD_HR_Staffing_Board_Update-102826-1-copy.pdf',
            pageRange: 'pp. 1–18',
            extractionStatus: 'text-extracted',
          },
        ],
      },
      {
        itemLabel: '8.1',
        titleEn: 'Integrated and Designated English Language Development (ELD) Programs Board Report',
        titleEs: 'Informe sobre los Programas de Desarrollo del Idioma Inglés (ELD) Integrado y Designado',
        actionType: 'Report',
        allocatedMinutes: 35,
        proposalStatusBadgeEn: 'Information Report — LCAP Goal 2',
        proposalStatusBadgeEs: 'Informe Informativo — Meta 2 del LCAP',
        whatIsProposedEn:
          'Educational Services reports on instructional coaching, professional development, and outcomes for RCSD’s 1,876 English learners (30% of the 6,276 students cited in the ELD deck). On the LCAP Goal 2 measure, the share of grade 2–8 English learners who progressed at least one ELPAC level, 41.9% did so in 2025-26, up from 38.7% (2023-24) and 41.6% (2024-25); the goal is 55% by June 2027. The reclassification rate was 12.1% (LCAP target 20%) and the long-term English learner rate 11.2% (target 10%).',
        whatIsProposedEs:
          'Servicios Educativos informa sobre la capacitación docente y los resultados de los 1,876 estudiantes aprendices de inglés de RCSD (30% de los 6,276 estudiantes citados en la presentación). En la medida de la Meta 2 del LCAP, el porcentaje de aprendices de inglés de 2.º a 8.º grado que avanzaron al menos un nivel en el ELPAC, el 41.9% lo logró en 2025-26, frente a 38.7% (2023-24) y 41.6% (2024-25); la meta es 55% para junio de 2027. La tasa de reclasificación fue de 12.1% (meta del LCAP: 20%) y la de aprendices de inglés de largo plazo, 11.2% (meta: 10%).',
        whyItMattersEn:
          'Nearly one in three RCSD students is an English learner. The LCAP Goal 2 measure rose 0.3 points over last year and sits 13.1 points below the June 2027 target of 55%. This is not the state Dashboard English Learner Progress Indicator (ELPI), which counts all tested English learners: the CDE’s 2026 Dashboard file puts RCSD’s ELPI at 47.8% (766 of 1,604), and the deck reports it as 48% (738 of 1,538).',
        whyItMattersEs:
          'Casi uno de cada tres estudiantes de RCSD aprende inglés. La medida de la Meta 2 del LCAP subió 0.3 puntos respecto al año pasado y está 13.1 puntos por debajo de la meta del 55% para junio de 2027. No es el Indicador de Progreso de Aprendices de Inglés (ELPI) del Dashboard estatal, que cuenta a todos los aprendices de inglés evaluados: el archivo del Dashboard 2026 del CDE da a RCSD un ELPI de 47.8% (766 de 1,604), y la presentación lo reporta como 48% (738 de 1,538).',
        baselineContext: {
          metricNameEn: 'LCAP Goal 2: Grade 2–8 English Learners Progressing ≥1 ELPAC Level; Reclassification',
          metricNameEs: 'Meta 2 del LCAP: Aprendices de Inglés de 2.º a 8.º que Avanzan ≥1 Nivel en el ELPAC; Reclasificación',
          censusDate: '2025-26 Summative ELPAC (district-reported LCAP metric)',
          fiscalPeriod: 'LCAP Goal 2 target year: June 2027',
          certificationStatus: 'district-reported-series',
          priorBaselineNoteEn:
            'LCAP Goal 2 measure (grade 2–8 English learners progressing at least one ELPAC level): 38.7% (2023-24) → 41.6% (2024-25) → 41.9% (2025-26) vs. 55% June 2027 goal (ELD deck pp. 6–7). Separate state measure: Dashboard ELPI 47.8% in 2025-26 (766 of 1,604; CDE 2026 Dashboard file), 47.9% the year before.',
          priorBaselineNoteEs:
            'Medida de la Meta 2 del LCAP (aprendices de inglés de 2.º a 8.º grado que avanzan al menos un nivel en el ELPAC): 38.7% (2023-24) → 41.6% (2024-25) → 41.9% (2025-26) frente a la meta del 55% para junio de 2027 (presentación ELD, pp. 6–7). Medida estatal distinta: ELPI del Dashboard de 47.8% en 2025-26 (766 de 1,604; archivo del Dashboard 2026 del CDE), 47.9% el año anterior.',
        },
        citations: [
          {
            labelEn: 'Integrated & Designated ELD Board Report Deck (enrollment, LCAP Goal 2, reclassification, LTEL)',
            labelEs: 'Presentación de Desarrollo del Idioma Inglés (ELD) (matrícula, Meta 2 del LCAP, reclasificación, LTEL)',
            filename: 'RCSD_Board_ELD_Oct2026.pptx-1.pdf',
            pageRange: 'pp. 3–10',
            extractionStatus: 'text-extracted',
          },
          {
            labelEn: 'CDE 2026 California School Dashboard ELPI data file (RCSD district row, EL group)',
            labelEs: 'Archivo de datos ELPI del Dashboard Escolar de California 2026 del CDE (fila del distrito RCSD, grupo EL)',
            url: 'https://www3.cde.ca.gov/researchfiles/cadashboard/elpidownload2026.txt',
            extractionStatus: 'text-extracted',
          },
        ],
      },
      {
        itemLabel: '11.1–11.2',
        titleEn: 'Resolutions No. 12 (PremierOne Credit Union Signatory) & No. 13 (Education Code Teaching Assignment)',
        titleEs: 'Resoluciones N.º 12 (Firmante Autorizado en PremierOne Credit Union) y N.º 13 (Asignación Docente según el Código de Educación)',
        actionType: 'Action',
        allocatedMinutes: 5,
        proposalStatusBadgeEn: 'Proposed Action — Board Resolutions',
        proposalStatusBadgeEs: 'Acción Propuesta — Resoluciones de la Junta',
        whatIsProposedEn:
          'Resolution 12 adds the Interim Administrative Assistant to the Superintendent as an authorized signatory on the District’s PremierOne Credit Union accounts (savings and credit card accounts used when vendors do not accept purchase orders) during a temporary leave in the Superintendent’s Office. Resolution 13 approves one 2026-27 local assignment option (Exhibit A): a Multiple Subject credential holder teaching grades 6–8 social science at Roy Cloud under Education Code 44256(b), with the teacher’s consent; the memo attributes the need to a site master-scheduling error.',
        whatIsProposedEs:
          'La Resolución 12 agrega al puesto de Asistente Administrativo(a) Interino(a) del Superintendente como firmante autorizado en las cuentas del distrito en PremierOne Credit Union (cuentas de ahorro y de tarjeta de crédito que se usan cuando un proveedor no acepta órdenes de compra) durante una licencia temporal en la Oficina del Superintendente. La Resolución 13 aprueba una opción de asignación local para 2026-27 (Anexo A): un maestro con credencial de Materias Múltiples que enseña ciencias sociales de 6.º a 8.º grado en Roy Cloud bajo el Código de Educación 44256(b), con su consentimiento; el memorando lo atribuye a un error en el horario maestro de la escuela.',
        whyItMattersEn:
          'These are the two standalone Open Session action items on the October 28 agenda (a 5-minute Action Items section); all major financial contracts and policy revisions are bundled on the Consent Calendar below.',
        whyItMattersEs:
          'Estos son los dos únicos puntos de acción individual en sesión pública del 28 de octubre (sección de Puntos de Acción de 5 minutos); todos los contratos financieros mayores y las revisiones de políticas están agrupados en el Calendario de Consentimiento a continuación.',
        citations: [
          {
            labelEn: 'Resolution No. 12 (PremierOne signatories)',
            labelEs: 'Resolución N.º 12 (Firmantes PremierOne)',
            filename: 'Resolution-12-PremierOne-Bank.pdf',
            pageRange: 'p. 1',
            extractionStatus: 'text-extracted',
          },
          {
            labelEn: 'Resolution No. 13 (Ed Code teaching assignment)',
            labelEs: 'Resolución N.º 13 (Asignación docente)',
            filename: 'Resolution-No.-13-Education-Code-for-2026_2027-School-Year-10.28.26.pdf',
            pageRange: 'p. 1',
            extractionStatus: 'text-extracted',
          },
          {
            labelEn: 'Resolution No. 13 Exhibit A (assignment list)',
            labelEs: 'Resolución N.º 13, Anexo A (lista de asignaciones)',
            filename: 'Exhibit-A_-Ed-Code-Teacher-Assignment-10.28.26.pdf',
            pageRange: 'pp. 1–2',
            extractionStatus: 'text-extracted',
          },
        ],
      },
    ],
    consentScreening: {
      totalConsentItems: 23,
      thresholdUsd: 50000,
      spotlightItems: [
        {
          itemLabel: '10.6',
          titleEn: 'Boys & Girls Clubs of the Peninsula Expanded Day Learning Agreement (FY 2026-27)',
          titleEs: 'Acuerdo con Boys & Girls Clubs of the Peninsula para Programas de Día Extendido (2026-27)',
          amountDisplay: 'Not to exceed $1,820,949.00',
          fundingSourceEn: 'ASES and ELO-P State Grants (Restricted — contingent on state grant funding)',
          fundingSourceEs: 'Subvenciones Estatales ASES y ELO-P (Restringido — sujeto a fondos estatales)',
          flags: ['financial-threshold'],
          summaryEn:
            'Operates after-school and expanded-day learning programs at five sites: Garfield, Taft, Hoover, Kennedy Middle, and McKinley Institute of Technology (MIT).',
          summaryEs:
            'Opera programas de aprendizaje después de clases y de día extendido en cinco escuelas: Garfield, Taft, Hoover, Kennedy Middle y McKinley Institute of Technology (MIT).',
          citations: [
            {
              labelEn: 'BGCP Expanded Day Agreement (FY 2026-27)',
              labelEs: 'Contrato BGCP (2026-27)',
              filename: 'Boys-and-Girls-Club-Agreement-2026.27-board-10.28.26.pdf',
              extractionStatus: 'text-extracted',
            },
          ],
        },
        {
          itemLabel: '10.7',
          titleEn: 'City of Redwood City (REACH) Expanded Learning Agreement (SY 2026-27 & Summer 2027)',
          titleEs: 'Acuerdo con la Ciudad de Redwood City (REACH) para Aprendizaje Extendido (2026-27 y Verano 2027)',
          amountDisplay: 'Not to exceed $1,505,205.96',
          fundingSourceEn: 'ASES and ELO-P State Grants (Restricted)',
          fundingSourceEs: 'Subvenciones Estatales ASES y ELO-P (Restringido)',
          flags: ['financial-threshold'],
          summaryEn:
            'Funds REACH after-school programming at Henry Ford, Roosevelt, Adelante Selby, and Orion ($1,360,820.62) plus summer 2027 programming at sites still to be determined ($144,385.34); ASES pays $473,695.92 and ELO-P $1,031,510.04.',
          summaryEs:
            'Financia el programa REACH después de clases en Henry Ford, Roosevelt, Adelante Selby y Orion ($1,360,820.62) y el programa de verano 2027 en escuelas aún por definir ($144,385.34); ASES aporta $473,695.92 y ELO-P $1,031,510.04.',
          citations: [
            {
              labelEn: 'City of Redwood City REACH Agreement (2026-27)',
              labelEs: 'Acuerdo REACH con la Ciudad de Redwood City (2026-27)',
              filename: 'City-of-RC-REACH-Agreement-2026.27.pdf',
              extractionStatus: 'text-extracted',
            },
          ],
        },
        {
          itemLabel: '10.8',
          titleEn: 'College Advising Prep (CAP) Tutoring Services Agreement (SY 2026-27)',
          titleEs: 'Acuerdo con College Advising Prep (CAP) para Servicios de Tutoría (2026-27)',
          amountDisplay: 'Not to exceed $280,000.00',
          fundingSourceEn: 'ELO-P and Learning Recovery grants (contingent on grant funding)',
          fundingSourceEs: 'Subvenciones ELO-P y Learning Recovery (sujeto a esos fondos)',
          flags: ['financial-threshold'],
          summaryEn:
            'Provides in-person small-group tutoring for Expanded Learning students at seven sites (about 25 students per site), October 28, 2026 – June 30, 2027: Clifford, Roosevelt, Garfield, Taft and Hoover through Community Schools & Partnerships ($200,000), and MIT and Kennedy through Educational Services ($80,000).',
          summaryEs:
            'Brinda tutoría presencial en grupos pequeños a estudiantes de Aprendizaje Extendido en siete escuelas (unos 25 estudiantes por escuela), del 28 de octubre de 2026 al 30 de junio de 2027: Clifford, Roosevelt, Garfield, Taft y Hoover por medio de Escuelas Comunitarias ($200,000), y MIT y Kennedy por medio de Servicios Educativos ($80,000).',
          citations: [
            {
              labelEn: 'College Advising Prep Agreement (2026-27)',
              labelEs: 'Contrato College Advising Prep (2026-27)',
              filename: 'CAP-Agreement-26.27-Board-10.28.26.pdf',
              extractionStatus: 'text-extracted',
            },
          ],
        },
        {
          itemLabel: '10.4',
          titleEn: 'Measure U Parcel Tax Disbursement for KIPP Excelencia Community Prep (2026-27)',
          titleEs: 'Desembolso de Fondos de la Medida U para KIPP Excelencia Community Prep (2026-27)',
          amountDisplay: '$156,326.00 (estimated)',
          fundingSourceEn: 'Measure U Parcel Tax (Charter share)',
          fundingSourceEs: 'Impuesto Parcelario Medida U (Participación chárter)',
          flags: ['financial-threshold', 'charter-or-parcel-tax'],
          summaryEn:
            'Disburses KIPP Excelencia’s 2026-27 Measure U parcel tax allocation to fund 1.36 FTE of lower- and upper-school math leadership. Note: The attached application PDF is a scan; the $156,326 figure is verified from the board memo.',
          summaryEs:
            'Desembolsa la asignación 2026-27 de la Medida U para KIPP Excelencia para financiar 1.36 FTE de liderazgo en matemáticas. Nota: El PDF adjunto es un documento escaneado; la cifra de $156,326 proviene del memorando oficial.',
          citations: [
            {
              labelEn: 'KIPP Excelencia 2026-27 Measure U Application (Scanned PDF — memo figure)',
              labelEs: 'Solicitud Medida U 2026-27 de KIPP Excelencia (PDF escaneado)',
              filename: '2026.27-Measure-U-KIPP-Excelencia.pdf',
              extractionStatus: 'scanned-memo-fallback',
            },
          ],
        },
        {
          itemLabel: '10.9',
          titleEn: 'Professional Charter Services, LLC Supplemental Student Transportation Agreement',
          titleEs: 'Acuerdo con Professional Charter Services, LLC para Transporte Estudiantil Suplementario',
          amountDisplay: 'Up to $100,000.00 ($180–$210/hr, 4-hr min)',
          fundingSourceEn: 'Unrestricted General Fund',
          fundingSourceEs: 'Fondo General No Restringido',
          flags: ['financial-threshold'],
          summaryEn:
            'As-needed supplemental school bus and SPAB service for field trips and school activities, September 2, 2026 – June 30, 2027 (ratification), billed hourly by vehicle size with a four-hour minimum per dispatch.',
          summaryEs:
            'Servicio suplementario de autobús escolar y SPAB, según se necesite, para excursiones y actividades escolares, del 2 de septiembre de 2026 al 30 de junio de 2027 (ratificación), con tarifa por hora según el tamaño del vehículo y un mínimo de cuatro horas por servicio.',
          citations: [
            {
              labelEn: 'Professional Charter Services Agreement (10/28/26)',
              labelEs: 'Contrato Professional Charter Services (28/10/26)',
              filename: 'Professional-Charter-Services-Board-10.28.26.pdf',
              extractionStatus: 'text-extracted',
            },
          ],
        },
        {
          itemLabel: '6.1',
          titleEn: 'DSA and PG&E Fees for HVAC Upgrades Projects (Phases 1, 2, and 3)',
          titleEs: 'Tarifas de DSA y PG&E para Proyectos de Mejoras de HVAC (Fases 1, 2 y 3)',
          amountDisplay: '$69,089.12',
          fundingSourceEn: 'Measure S Bond (Fund 21)',
          fundingSourceEs: 'Bono Medida S (Fondo 21)',
          flags: ['financial-threshold'],
          summaryEn:
            'Covers additional Phase 1 DSA fees after final construction valuations exceeded estimates (Roosevelt $19,042.71, Taft $13,026.41), a $3,500 PG&E engineering advance for Clifford (Phase 2), and $16,760 DSA plan-review filing fees each for Roy Cloud and Henry Ford, which puts Phase 3 into DSA review. Attached fee receipts are scans; figures are from the board memo.',
          summaryEs:
            'Cubre tarifas adicionales de DSA en la Fase 1 porque la valuación final de construcción superó lo estimado (Roosevelt $19,042.71, Taft $13,026.41), un anticipo de ingeniería de PG&E de $3,500 para Clifford (Fase 2) y $16,760 en tarifas de revisión de planos ante DSA para cada una de Roy Cloud y Henry Ford (Fase 3). Los recibos PDF son escaneos; las cifras provienen del memorando.',
          citations: [
            {
              labelEn: 'Roy Cloud & Henry Ford Phase 3 DSA Fee Receipts (Scanned PDF)',
              labelEs: 'Recibos de Tarifas DSA Fase 3 — Roy Cloud y Henry Ford (PDF escaneado)',
              filename: 'Roy-Cloud-phase-3-DSA-Fees.pdf',
              extractionStatus: 'scanned-memo-fallback',
            },
          ],
        },
        {
          itemLabel: '10.11',
          titleEn: 'Davey Tree Expert Company Annual Tree Health Care & Risk Management Proposals (14 Sites)',
          titleEs: 'Propuestas de Davey Tree Expert Company para Cuidado y Gestión de Riesgo de Árboles (14 Sitios)',
          amountDisplay: '$52,705.00 (sum across 14 site proposals)',
          fundingSourceEn: 'Facilities/Maintenance budget',
          fundingSourceEs: 'Presupuesto de Instalaciones y Mantenimiento',
          flags: ['financial-threshold'],
          summaryEn:
            'Annual tree pruning, health care, and risk management across 14 district school and facility sites; the 14 individual site PDFs sum to $52,705 matching the memo.',
          summaryEs:
            'Poda anual, cuidado fitosanitario y gestión de riesgos en 14 planteles y propiedades del distrito; las 14 propuestas individuales suman $52,705.',
          citations: [
            {
              labelEn: 'Davey Tree Proposal — Adelante Selby (+ 13 additional site PDFs)',
              labelEs: 'Propuesta Davey Tree — Adelante Selby (+ 13 PDFs por sitio)',
              filename: 'Davey-Tree-Adelante-Selby.pdf',
              extractionStatus: 'text-extracted',
            },
          ],
        },
        {
          itemLabel: '10.12–10.22',
          titleEn: '11 Board Policy Revisions (Nondiscrimination, Safety Plan, Complaints, Staff Development, Student Disturbances, Child Abuse Reporting, Instructional Materials)',
          titleEs: '11 Revisiones de Políticas de la Junta (No Discriminación, Plan de Seguridad, Quejas, Desarrollo del Personal, Disturbios Estudiantiles, Reporte de Abuso Infantil, Materiales Educativos)',
          amountDisplay: 'No direct cost (Governance Policy Updates)',
          fundingSourceEn: 'N/A — CSBA Gamut Policy Updates',
          fundingSourceEs: 'N/A — Actualizaciones de Políticas CSBA Gamut',
          flags: ['policy-or-bylaw-revision'],
          summaryEn:
            'Adopts marked and clean revisions to 11 Board Policies on a single consent vote: BP 0410 (Nondiscrimination), BP 0450 (Comprehensive Safety Plan), BP 1312.2 (Complaints Concerning Instructional Materials), BP 1312.3 (Uniform Complaint Procedures), BP 4131/4231/4331 (Staff Development), BP 5131.4 (Student Disturbances), BP 5141.4 (Child Abuse Prevention and Reporting), BP 6161.1 (Selection and Evaluation of Instructional Materials), and BP 6161.11 (Supplementary Instructional Materials).',
          summaryEs:
            'Adopta versiones marcadas y limpias de 11 Políticas de la Junta en una sola votación de consentimiento: BP 0410 (No discriminación), BP 0450 (Plan integral de seguridad), BP 1312.2 y BP 1312.3 (Procedimientos de quejas), BP 4131/4231/4331 (Desarrollo profesional), BP 5131.4 (Disturbios estudiantiles), BP 5141.4 (Prevención y reporte de abuso infantil), BP 6161.1 y BP 6161.11 (Materiales educativos).',
          citations: [
            {
              labelEn: 'BP 0410 Nondiscrimination (Marked Redline)',
              labelEs: 'BP 0410 No Discriminación (Versión Marcada)',
              filename: 'Policy-0410_-Nondiscrimination-In-District-Programs-And-Activities-Marked-10.28..pdf',
              extractionStatus: 'text-extracted',
            },
            {
              labelEn: 'BP 1312.3 Uniform Complaint Procedures (Marked Redline)',
              labelEs: 'BP 1312.3 Procedimientos Uniformes de Quejas (Versión Marcada)',
              filename: 'Policy-1312.3_-Uniform-Complaint-Procedures-Marked-10.28.26.pdf',
              extractionStatus: 'text-extracted',
            },
          ],
        },
      ],
      routineSummaryEn:
        'The remaining 5 consent items cover: draft minutes of the September 23 meeting (10.1), acceptance of an Art in Action drying rack donation for Clifford School (10.2), Taft Outdoor Education field trip Feb 8–11, 2027 (10.3), the routine certificated/classified Personnel Report (10.5), and the SMCOE LiveScan fingerprinting billing MOU up to $25,000/yr (10.10).',
      routineSummaryEs:
        'Los 5 puntos de consentimiento restantes cubren: el borrador de actas del 23 de septiembre (10.1), la donación de un estante de secado de Art in Action para la escuela Clifford (10.2), el viaje de educación al aire libre de Taft del 8 al 11 de febrero de 2027 (10.3), el Informe de Personal de rutina (10.5) y el memorando con SMCOE para facturación de huellas LiveScan hasta por $25,000/año (10.10).',
      extractionNotes: [
        {
          itemLabel: '6.1 & 10.4',
          noteEn:
            'Scanned PDFs detected: The 5 DSA/PG&E fee receipts (Item 6.1) and KIPP Excelencia’s Measure U application (Item 10.4) are image scans without embedded text layers. Dollar totals ($69,089.12 and $156,326.00) are verified from the structured Simbli board memo.',
          noteEs:
            'PDFs escaneados detectados: Los 5 recibos de tarifas de DSA/PG&E (Punto 6.1) y la solicitud de la Medida U de KIPP Excelencia (Punto 10.4) son imágenes escaneadas sin capa de texto. Los montos ($69,089.12 y $156,326.00) fueron verificados a partir del memorando oficial en Simbli.',
        },
        {
          itemLabel: '13.2',
          noteEn:
            'External links: The San Mateo County Investment and Compliance Reports (Information Item 13.2) link externally to smcgov.org rather than Simbli packet attachments.',
          noteEs:
            'Enlaces externos: Los Informes de Inversión y Cumplimiento del Condado de San Mateo (Punto Informativo 13.2) enlazan externamente a smcgov.org.',
        },
      ],
    },
  },

  '2026-10-14': {
    date: '2026-10-14',
    meetingSlug: '2026-10-14-regular',
    meetingStage: 'completed',
    qualityState: 'human-reviewed',
    overviewEn:
      'Anchored by the statutory Public Hearing on KIPP Excelencia Community Prep’s 2027–2032 charter renewal petition (Item 8.1) and an update on the Health and Wellness Department (Item 9.1), which the Board reordered live to occur ahead of the public hearing. On the Bond Consent Calendar, Change Order #3 for McKinley (MIT) Solar Phase 2 added $81,760.42.',
    overviewEs:
      'Encabezada por la Audiencia Pública legal sobre la petición de renovación chárter 2027–2032 de KIPP Excelencia Community Prep (Punto 8.1) y una actualización del Departamento de Salud y Bienestar (Punto 9.1), que la Junta adelantó en vivo antes de la audiencia pública. En el Calendario de Consentimiento del Bono, la Orden de Cambio N.º 3 del proyecto solar Fase 2 en McKinley (MIT) sumó $81,760.42.',
    scheduleChangesNoteEn:
      'Live agenda reorder: Item 9.1 (Health and Wellness Department update) was moved up to occur immediately after Section 6 (Bond Program Consent Items), ahead of the KIPP Excelencia Public Hearing (Item 8.1). Also note: the September 28 revision of the Parking Lot of Ideas shifted the "Orion Squeeze" (two additional classrooms) and "Supporting MIT & Enrollment Plan" implementation timelines by one year to 2028-29.',
    scheduleChangesNoteEs:
      'Cambio de orden en vivo: El Punto 9.1 (actualización del Departamento de Salud y Bienestar) se adelantó inmediatamente después de la Sección 6 (Consentimiento del Bono), antes de la Audiencia Pública de KIPP Excelencia (Punto 8.1). Además, la revisión del 28 de septiembre de la Lista de Ideas pospuso un año (a 2028-29) la implementación de las aulas adicionales para Orion y el plan para MIT.',
    topItems: [
      {
        itemLabel: '9.1',
        titleEn: 'Update on the Redwood City School District Health and Wellness Department',
        titleEs: 'Actualización sobre el Departamento de Salud y Bienestar de RCSD',
        actionType: 'Report',
        allocatedMinutes: 35,
        proposalStatusBadgeEn: 'Information Report — Student Health Services',
        proposalStatusBadgeEs: 'Informe Informativo — Servicios de Salud Estudiantil',
        whatIsProposedEn:
          'Director of Health and Wellness Patrinia Redd and District Lead Nurses Lisa Cox and Phoebe Reid-Chambers present 2025-26 hearing, vision and dental screening results, a student CPR certification class (48 students completed it in August and September 2026), a Safe Routes to School e-bike survey, behavior supports, the Sequoia Healthcare District partnership, and the department’s goals.',
        whatIsProposedEs:
          'La Directora de Salud y Bienestar, Patrinia Redd, y las Enfermeras Principales del Distrito, Lisa Cox y Phoebe Reid-Chambers, presentan los resultados 2025-26 de las evaluaciones de audición, vista y salud dental, una clase de certificación en RCP para estudiantes (48 estudiantes la completaron en agosto y septiembre de 2026), una encuesta de Safe Routes to School sobre bicicletas eléctricas (e-bikes), los apoyos de conducta, la colaboración con el Sequoia Healthcare District y las metas del departamento.',
        whyItMattersEn:
          'The department ties health screenings and follow-up to reducing chronic absenteeism (one of its stated goals), and the memo puts the 2026-27 Sequoia Healthcare District MOU, its main outside funding, at $1,488,605.',
        whyItMattersEs:
          'El departamento vincula las evaluaciones de salud y su seguimiento con la reducción del ausentismo crónico (una de sus metas declaradas), y el memorando indica que el MOU 2026-27 con el Sequoia Healthcare District, su principal financiamiento externo, es de $1,488,605.',
        citations: [
          {
            labelEn: 'Health and Wellness Department Board Report Deck (10/14/26)',
            labelEs: 'Presentación del Departamento de Salud y Bienestar (14/10/26)',
            filename: '26.10.14-Health-and-Wellness-Board-Report.pdf',
            pageRange: 'pp. 1–19',
            extractionStatus: 'text-extracted',
          },
        ],
      },
      {
        itemLabel: '8.1',
        titleEn: 'Public Hearing: KIPP Excelencia Charter Renewal Petition (July 1, 2027 – June 30, 2032)',
        titleEs: 'Audiencia Pública: Petición de Renovación Chárter de KIPP Excelencia (1 de julio de 2027 – 30 de junio de 2032)',
        actionType: 'Public Hearing',
        allocatedMinutes: 30,
        proposalStatusBadgeEn: 'Public Hearing Only — Statutory Decision Due by Dec 20, 2026',
        proposalStatusBadgeEs: 'Solo Audiencia Pública — Decisión Legal Antes del 20 de Dic. de 2026',
        whatIsProposedEn:
          'KIPP Excelencia Community Prep submitted its renewal petition on September 21, 2026, requesting a five-year term (July 1, 2027 – June 30, 2032); the petition places the school in the state’s "middle performing" renewal category (Ed Code 47607.2). This October 14 item is the public hearing on the level of support for the petition; no grant-or-deny vote is on this agenda, and the memo anticipates Board action on December 9, 2026.',
        whatIsProposedEs:
          'KIPP Excelencia Community Prep presentó su petición de renovación el 21 de septiembre de 2026, solicitando un periodo de cinco años (1 de julio de 2027 – 30 de junio de 2032); la petición ubica a la escuela en la categoría estatal de desempeño medio ("middle performing") para renovación (Código de Educación 47607.2). Este punto del 14 de octubre es la audiencia pública sobre el nivel de apoyo a la petición; no hay votación de aprobación o rechazo en esta sesión, y el memorando prevé la decisión de la Junta el 9 de diciembre de 2026.',
        whyItMattersEn:
          'Receipt of the petition on September 21 started a 90-day statutory clock under Ed Code 47605(b), requiring Board action to grant or deny by December 20, 2026 (unless extended by 30 days by mutual agreement). The petition’s multi-year budget projects an operating deficit in every year from 2026-27 through 2031-32, with ending fund balance falling from $3.50M to $1.84M (about 23% to 11% of expenditures), still above the 5% reserve floor in the MOU.',
        whyItMattersEs:
          'La recepción de la petición el 21 de septiembre inició el plazo legal de 90 días bajo el Código de Educación 47605(b), que exige una decisión de la Junta a más tardar el 20 de diciembre de 2026 (salvo prórroga mutua de 30 días). El presupuesto plurianual de la petición proyecta un déficit operativo en cada año de 2026-27 a 2031-32, con un saldo final que baja de $3.50M a $1.84M (de cerca del 23% al 11% de los gastos), todavía por encima de la reserva mínima del 5% del MOU.',
        baselineContext: {
          metricNameEn: 'Charter Renewal Statutory Timeline & Reserve Ratio',
          metricNameEs: 'Plazo Legal de Renovación Chárter y Nivel de Reservas',
          censusDate: 'Petition received September 21, 2026',
          fiscalPeriod: 'Proposed Term: FY 2027-28 through FY 2031-32',
          certificationStatus: 'statutory-clock-active',
          priorBaselineNoteEn:
            '90-day Ed Code 47605(b) deadline expires December 20, 2026; last regular December board meetings are December 9 and December 16, 2026.',
          priorBaselineNoteEs:
            'El plazo de 90 días vence el 20 de diciembre de 2026; las últimas reuniones ordinarias antes de esa fecha son el 9 y el 16 de diciembre de 2026.',
        },
        citations: [
          {
            labelEn: 'KIPP Excelencia Charter Renewal Packet 2027–2032 (performance category; multi-year budget)',
            labelEs: 'Paquete de Renovación Chárter de KIPP Excelencia 2027–2032 (categoría de desempeño; presupuesto plurianual)',
            filename: 'KIPP-Excelencia-Charter-Renewal-Packet.pdf',
            pageRange: 'pp. 3, 9, 346–347 of 608',
            extractionStatus: 'text-extracted',
          },
          {
            labelEn: 'KIPP Excelencia Public Hearing Presentation Deck (updated)',
            labelEs: 'Presentación de Audiencia Pública de KIPP Excelencia (actualizada)',
            filename: 'KIPP-Excelencia-Community-Prep_-Public-Hearing-26.10.14-updated.pdf',
            pageRange: 'pp. 1–21',
            extractionStatus: 'text-extracted',
          },
        ],
      },
      {
        itemLabel: '12.1',
        titleEn: 'Approval of Personnel Changes & New Director of Fiscal Services Job Description',
        titleEs: 'Aprobación de Cambios de Personal y Nueva Descripción de Puesto para Director(a) de Servicios Fiscales',
        actionType: 'Action',
        allocatedMinutes: 2.5,
        proposalStatusBadgeEn: 'Action Item — Approved by Voice Vote',
        proposalStatusBadgeEs: 'Punto de Acción — Aprobado por Voto de Voz',
        whatIsProposedEn:
          'Adds three positions for 2026-27 (a 7-hour Campus Supervisor at Kennedy, est. $65,394; a 6-hour LVN at Clifford for a student’s required 1:1 care, est. $99,541; and a Director IV for Fiscal Services, est. $30,325 maximum exposure this year) and approves the updated Director of Fiscal Services job description: a classified-management role reporting to the Chief Business Official that leads the budget, interim reports and Unaudited Actuals, manages the annual audit, and supervises two Accounting Managers. The retiring Director II position stays through January 31 and is scheduled to close at year end.',
        whatIsProposedEs:
          'Agrega tres puestos para 2026-27 (un(a) Supervisor(a) de Plantel de 7 horas en Kennedy, costo estimado $65,394; un(a) LVN de 6 horas en Clifford para la atención individual que requiere un estudiante, $99,541; y un(a) Director(a) IV de Servicios Fiscales, $30,325 de costo máximo este año) y aprueba la descripción actualizada del puesto de Director(a) de Servicios Fiscales: un puesto gerencial clasificado que reporta al Director de Finanzas (CBO), dirige el presupuesto, los informes interinos y los Resultados No Auditados, gestiona la auditoría anual y supervisa a dos Gerentes de Contabilidad. El puesto de Director II, cuyo titular se jubila, sigue hasta el 31 de enero y se cerrará al final del año fiscal.',
        whyItMattersEn:
          'The Director IV replaces a retiring Director II with what the memo calls an expanded scope for Fiscal Services, as the district heads into First Interim and pending labor settlements.',
        whyItMattersEs:
          'El puesto de Director IV reemplaza a un Director II que se jubila, con lo que el memorando describe como un alcance ampliado para Servicios Fiscales, mientras el distrito se prepara para el Primer Informe Interino y los acuerdos laborales pendientes.',
        citations: [
          {
            labelEn: 'Director of Fiscal Services Job Description (Item 12.1)',
            labelEs: 'Descripción del Puesto de Director(a) de Servicios Fiscales (Punto 12.1)',
            filename: 'RCSD_Director_of_Fiscal_Services_JD_2026.docx.pdf',
            pageRange: 'pp. 1–3',
            extractionStatus: 'text-extracted',
          },
        ],
      },
    ],
    consentScreening: {
      totalConsentItems: 13,
      thresholdUsd: 50000,
      spotlightItems: [
        {
          itemLabel: '6.1',
          titleEn: 'Change Order #3 — McKinley Institute of Technology (MIT) Solar Project Phase 2 (Holt Renewables)',
          titleEs: 'Orden de Cambio N.º 3 — Proyecto Solar Fase 2 en McKinley (MIT) (Holt Renewables)',
          amountDisplay: '+$81,760.42 (New contract total: $2,373,353.04)',
          fundingSourceEn: 'Fund 40 — Special Reserve Fund for Capital Projects',
          fundingSourceEs: 'Fondo 40 — Fondo de Reserva Especial para Proyectos de Capital',
          flags: ['financial-threshold', 'contract-amendment-or-change-order'],
          summaryEn:
            'Adds $81,760.42 ($72,228.97 Teichert subcontract work plus $9,531.45 Holt project management and markup) and 2 calendar days for removing an existing backstop, groundwater dewatering in Array B, and temporary casing for an unstable foundation shaft in the former maintenance area, raising the Holt Renewables contract from $2,282,128.00 originally ($2,291,592.62 before this change order) to $2,373,353.04.',
          summaryEs:
            'Agrega $81,760.42 ($72,228.97 de trabajo del subcontratista Teichert más $9,531.45 de gestión y margen de Holt) y 2 días calendario para retirar un backstop existente, extraer agua subterránea en el Arreglo B y colocar revestimiento temporal en una perforación inestable en la antigua área de mantenimiento, elevando el contrato con Holt Renewables de $2,282,128.00 originales ($2,291,592.62 antes de esta orden de cambio) a $2,373,353.04.',
          citations: [
            {
              labelEn: 'MIT Solar Phase 2 Change Order #3 — Additional Teichert Scope (revised)',
              labelEs: 'Orden de Cambio N.º 3 — Proyecto Solar MIT Fase 2 (alcance adicional de Teichert, revisada)',
              filename: '261014-RCSD-McKinley-CO-3-Additional-Teichert-Scope-REVISED-Board-10.14.26.pdf',
              extractionStatus: 'text-extracted',
            },
          ],
        },
        {
          itemLabel: '11.6',
          titleEn: 'After School Music Academy LLC Extended Learning Musical Enrichment Agreement (SY 2026-27)',
          titleEs: 'Acuerdo con After School Music Academy LLC para Enriquecimiento Musical en Aprendizaje Extendido (2026-27)',
          amountDisplay: 'Not to exceed $218,880.00',
          fundingSourceEn: 'Expanded Learning Opportunities Program (ELO-P) grant',
          fundingSourceEs: 'Subvención del Programa de Oportunidades de Aprendizaje Extendido (ELO-P)',
          flags: ['financial-threshold'],
          summaryEn:
            'Twenty-four weeks of Banda, West African drumming, Folklórico and Hip Hop instruction for students in the district’s expanded learning programs run by REACH, PAL, Casa Circulo Cultural, Boys & Girls Clubs of the Peninsula and Siena Youth Center, October 14, 2026 – June 30, 2027.',
          summaryEs:
            'Veinticuatro semanas de clases de banda, tambores de África Occidental, folklórico y hip hop para estudiantes de los programas de aprendizaje extendido del distrito a cargo de REACH, PAL, Casa Círculo Cultural, Boys & Girls Clubs of the Peninsula y Siena Youth Center, del 14 de octubre de 2026 al 30 de junio de 2027.',
          citations: [
            {
              labelEn: 'After School Music Academy Agreement (2026-27)',
              labelEs: 'Contrato After School Music Academy (2026-27)',
              filename: 'After-School-Music-Academy-Agreement-2026.27.pdf',
              extractionStatus: 'text-extracted',
            },
          ],
        },
        {
          itemLabel: '11.7',
          titleEn: 'BMR Health Services, Inc. Temporary Speech and Language Pathologist Agreement (2026-27, ratification)',
          titleEs: 'Acuerdo con BMR Health Services, Inc. para un(a) Terapeuta del Habla y Lenguaje Temporal (2026-27, ratificación)',
          amountDisplay: 'Not to exceed $82,160.00 ($130/hr)',
          fundingSourceEn: 'Special Education Fund',
          fundingSourceEs: 'Fondo de Educación Especial',
          flags: ['financial-threshold'],
          summaryEn:
            'A contracted speech and language pathologist covers an employee’s leave from October 5, 2026 to February 12, 2027 (assessments, IEP meetings and direct therapy); submitted for retroactive ratification because the paperwork was late.',
          summaryEs:
            'Un(a) terapeuta del habla y lenguaje contratado(a) cubre la licencia de un(a) empleado(a) del 5 de octubre de 2026 al 12 de febrero de 2027 (evaluaciones, reuniones de IEP y terapia directa); se presenta para ratificación retroactiva porque el papeleo se atrasó.',
          citations: [
            {
              labelEn: 'BMR Health Services SLP Agreement (2026-27)',
              labelEs: 'Contrato BMR Health Services, terapeuta del habla (2026-27)',
              filename: 'BMR_SLP-2026.27-Board-10.14.26.pdf',
              extractionStatus: 'text-extracted',
            },
          ],
        },
        {
          itemLabel: '11.9',
          titleEn: 'Marin COE / CCEE Community Engagement Initiative Peer Leading and Learning Network MOU',
          titleEs: 'Acuerdo (MOU) de la Iniciativa de Participación Comunitaria con Marin COE / CCEE',
          amountDisplay: 'Up to $70,000.00 incoming stipend to RCSD',
          fundingSourceEn: 'CCEE Community Engagement Initiative stipend (revenue to General Fund / Health and Wellness budget)',
          fundingSourceEs: 'Estipendio de la Iniciativa de Participación Comunitaria de CCEE (ingreso al Fondo General / presupuesto de Salud y Bienestar)',
          flags: ['financial-threshold'],
          summaryEn:
            'Kennedy Middle School was selected for Cohort VII of the Community Engagement Initiative’s Peer Leading and Learning Network (the MOU covers Cohort VI and/or VII). RCSD receives a performance-based stipend of up to $70,000 for 2026-27 to offset team and engagement costs; this is revenue to RCSD, not an expenditure.',
          summaryEs:
            'Kennedy Middle School fue seleccionada para la Cohorte VII de la Red de Liderazgo y Aprendizaje entre Pares de la Iniciativa de Participación Comunitaria (el MOU cubre las Cohortes VI y/o VII). RCSD recibe un estipendio por desempeño de hasta $70,000 para 2026-27 para cubrir costos del equipo y de participación; es un ingreso para el distrito, no un gasto.',
          citations: [
            {
              labelEn: 'Marin COE / CCEE Community Engagement Initiative MOU (2026-27)',
              labelEs: 'MOU de Participación Comunitaria con Marin COE / CCEE (2026-27)',
              filename: '26-27-Marin-County-Office-of-Education-MOU.pdf',
              extractionStatus: 'text-extracted',
            },
          ],
        },
        {
          itemLabel: '11.11',
          titleEn: 'September 1–30, 2026 Warrant Register',
          titleEs: 'Registro de Órdenes de Pago (Warrants) del 1 al 30 de septiembre de 2026',
          amountDisplay: '$8,006,731.54 net disbursements (all funds)',
          fundingSourceEn: 'All District Funds (General Fund $4,947,314.22; Measure T Building Fund $1,934,594.88; Fund 40 $590,256.02; others)',
          fundingSourceEs: 'Todos los Fondos del Distrito (Fondo General $4,947,314.22; Fondo de Construcción Medida T $1,934,594.88; Fondo 40 $590,256.02; otros)',
          flags: ['financial-threshold'],
          summaryEn:
            'Monthly ratification (Education Code 42631) of commercial checks drawn on the San Mateo County Treasury across all funds during September 2026.',
          summaryEs:
            'Ratificación mensual (Código de Educación 42631) de los cheques comerciales girados contra la Tesorería del Condado de San Mateo en todos los fondos durante septiembre de 2026.',
          citations: [
            {
              labelEn: 'Warrant Register — September 2026',
              labelEs: 'Registro de Pagos — Septiembre 2026',
              filename: 'Warrant-Register-September-2026.pdf',
              extractionStatus: 'text-extracted',
            },
          ],
        },
      ],
      routineSummaryEn:
        'The remaining 8 consent items cover: the Measure T tracking list of purchases under $20k, two Scapes Landscape mow-strip projects at Garfield and Kennedy totaling $8,514 from Fund 40 (6.2), draft September 30 minutes (11.1), four school field trips for Roosevelt, Hoover, Kennedy, and Garfield (11.2–11.5), the SMCOE PBIS Tier 1 training MOU up to $10,000 (11.8), and the LunchAssist child-nutrition compliance and training agreement up to $25,845 (11.10).',
      routineSummaryEs:
        'Los 8 puntos de consentimiento restantes cubren: la lista de compras menores a $20k de la Medida T, dos proyectos de bordes de concreto de Scapes Landscape en Garfield y Kennedy por $8,514 del Fondo 40 (6.2), el borrador de actas del 30 de septiembre (11.1), cuatro excursiones escolares de Roosevelt, Hoover, Kennedy y Garfield (11.2–11.5), el MOU de capacitación PBIS Nivel 1 con SMCOE hasta por $10,000 (11.8) y el acuerdo de cumplimiento y capacitación en nutrición escolar con LunchAssist hasta por $25,845 (11.10).',
      extractionNotes: [],
    },
  },

  '2026-09-30': {
    date: '2026-09-30',
    meetingSlug: '2026-09-30-special',
    meetingStage: 'completed',
    qualityState: 'human-reviewed',
    overviewEn:
      'Single-topic 6:00 PM Study Session (90 minutes allocated; adjourned 8:20 PM) on K–5 formative assessments: Professional Learning Communities, i-Ready Reading & Math diagnostics, and the Multitudes universal K–2 reading-difficulty screener. Per the draft minutes, trustees asked for cohort-based literacy progress data for TK/K students toward the district’s third-grade literacy goal and raised concerns about assessment burden, coaching capacity, and PLC implementation.',
    overviewEs:
      'Sesión de Estudio de un solo tema a las 6:00 p. m. (90 minutos asignados; se levantó a las 8:20 p. m.) sobre evaluaciones formativas de K–5: Comunidades de Aprendizaje Profesional, diagnósticos i-Ready de Lectura y Matemáticas, y Multitudes, la evaluación universal de dificultades de lectura de K–2. Según el borrador de actas, los miembros de la Junta pidieron datos de progreso en lectoescritura por cohorte para estudiantes de TK/K hacia la meta distrital de lectura en tercer grado y expresaron inquietudes sobre la carga de evaluaciones, la capacidad de coaching y la implementación de las PLC.',
    topItems: [
      {
        itemLabel: '6.1',
        titleEn: 'School/Community Reports: Update on Formative Assessments Utilized for K–5',
        titleEs: 'Informes Escolares/Comunitarios: Actualización sobre Evaluaciones Formativas Utilizadas en K–5',
        actionType: 'Study Session Report',
        allocatedMinutes: 90,
        proposalStatusBadgeEn: 'Study Session Deep Dive — Uncertified Early CAASPP & i-Ready Figures',
        proposalStatusBadgeEs: 'Sesión de Estudio — Cifras Preliminares de CAASPP e i-Ready',
        whatIsProposedEn:
          'Educational Services presents how K–5 teacher teams use Professional Learning Communities (PLCs), i-Ready Reading and Math diagnostic windows, and the Multitudes universal K–2 reading-difficulty screener. The slide deck reports district-wide i-Ready Reading growth of 54% (spring 2023-24 baseline) → 57% (spring 2024-25) → 60.7% (winter 2025-26) against a 66% goal for 2026-27, and Math growth of 46% → 47% → 56.4% against a 58% goal. It also shows preliminary 2025-26 CAASPP scores as of June 5, 2026 ("99% release" ELA: 50.6% met/exceeded; "97% release" Math: 43.7% met/exceeded; English Learners: 8.1% ELA and 2.6% Math vs. LCAP targets of 20% and 16%).',
        whatIsProposedEs:
          'Servicios Educativos presenta cómo los equipos docentes de K–5 utilizan las Comunidades de Aprendizaje Profesional (PLC), los diagnósticos i-Ready de Lectura y Matemáticas y Multitudes, la evaluación universal de dificultades de lectura de K–2. La presentación reporta un crecimiento en Lectura i-Ready de 54% (primavera 2023-24, base) → 57% (primavera 2024-25) → 60.7% (invierno 2025-26) frente a la meta del 66% para 2026-27, y en Matemáticas de 46% → 47% → 56.4% frente a la meta del 58%. También incluye resultados preliminares de CAASPP 2025-26 al 5 de junio de 2026 (50.6% en ELA y 43.7% en Matemáticas; Aprendices de Inglés: 8.1% en ELA y 2.6% en Matemáticas frente a metas del 20% y 16%).',
        whyItMattersEn:
          'Important methodological caveat: The deck’s "i-Ready Growth" percentages do not specify whether they represent median percent of typical growth or the share of students meeting annual typical growth, and compare Spring baselines against a Winter 2025-26 window. Additionally, the June 5, 2026 CAASPP figures are uncertified early district pulls rather than the official CDE state release.',
        whyItMattersEs:
          'Advertencia metodológica importante: Los porcentajes de "Crecimiento en i-Ready" de la presentación no especifican qué métrica exacta de crecimiento contabilizan y comparan cierres de primavera con una ventana de invierno 2025-26. Asimismo, los datos CAASPP al 5 de junio de 2026 son cifras preliminares internas aún no certificadas por el CDE.',
        baselineContext: {
          metricNameEn: 'LCAP Goal 3 i-Ready Growth & Preliminary 2025-26 CAASPP',
          metricNameEs: 'Meta 3 del LCAP: Crecimiento i-Ready y Resultados Preliminares CAASPP 2025-26',
          censusDate: 'CAASPP pull as of 2026-06-05 (97–99% release); i-Ready Winter 2025-26',
          fiscalPeriod: 'SY 2025-26 / LCAP 2026-27 Targets',
          certificationStatus: 'preliminary-uncertified',
          priorBaselineNoteEn:
            'The deck’s i-Ready columns compare spring 2023-24 (baseline) and spring 2024-25 with winter 2025-26, a mid-year window (deck p. 3); CAASPP figures are pre-certification district pulls as of June 5, 2026, not final CDE DataQuest releases.',
          priorBaselineNoteEs:
            'Las columnas de i-Ready de la presentación comparan primavera 2023-24 (base) y primavera 2024-25 con invierno 2025-26, una ventana de mitad de año (p. 3); las cifras CAASPP son reportes preliminares del distrito al 5 de junio de 2026, previos a la certificación oficial del CDE.',
        },
        citations: [
          {
            labelEn: 'Ed. Services Board Report: PLCs, Formative Assessment, i-Ready & Multitudes',
            labelEs: 'Informe de Servicios Educativos: PLC, Evaluación Formativa, i-Ready y Multitudes',
            filename: 'Ed.-Services-Board-Report.-updated-26.09.29.pdf',
            pageRange: 'pp. 1–44 (figures on p. 3)',
            extractionStatus: 'text-extracted',
          },
        ],
      },
    ],
    consentScreening: {
      totalConsentItems: 0,
      thresholdUsd: 50000,
      spotlightItems: [],
      routineSummaryEn: 'This Special Study Session had no Consent Calendar items.',
      routineSummaryEs: 'Esta Sesión Especial de Estudio no incluyó puntos en el Calendario de Consentimiento.',
      extractionNotes: [],
    },
  },

  '2026-09-23': {
    date: '2026-09-23',
    meetingSlug: '2026-09-23-regular',
    meetingStage: 'completed',
    qualityState: 'human-reviewed',
    overviewEn:
      'High-consequence fiscal and facilities meeting covering: (1) the 2026-27 Annual Enrollment & Capacity Review showing district schools at ~50% physical capacity overall (6,199 day-10 students vs. 12,362 capacity, ranging from 18% at Garfield to 90% at North Star and 79% at Orion); (2) the 2025-26 Unaudited Actuals closing the General Fund with a $9.73M operating deficit before an $11.0M RDA interfund transfer ($18.38M ending fund balance, ~4.0% reserve); and (3) fiscal oversight letters flagging reserve levels at Rocketship (4.48%) and out-year projections at Connect (3.69% by 2028-29).',
    overviewEs:
      'Reunión clave sobre finanzas e instalaciones que abarcó: (1) la Revisión Anual de Matrícula y Capacidad 2026-27, que muestra una ocupación física del ~50% en el distrito (6,199 estudiantes al día 10 frente a una capacidad de 12,362, desde 18% en Garfield hasta 90% en North Star y 79% en Orion); (2) el Cierre Financiero No Auditado 2025-26 con un déficit operativo de $9.73M en el Fondo General antes de una transferencia RDA de $11.0M (saldo final de $18.38M, ~4.0% de reserva); y (3) cartas de supervisión fiscal para escuelas chárter que señalan reservas por debajo del mínimo del 5% en Rocketship (4.48%) y proyecciones en Connect (3.69% para 2028-29).',
    topItems: [
      {
        itemLabel: '9.4 & 9.5',
        titleEn: '2025-26 Unaudited Actuals Financial Report & Resolution No. 10 (Gann Appropriations Limit)',
        titleEs: 'Informe Financiero de Resultados No Auditados 2025-26 y Resolución N.º 10 (Límite de Apropiaciones Gann)',
        actionType: 'Action',
        allocatedMinutes: 45,
        proposalStatusBadgeEn: 'Action Items — Unaudited Actuals Approved 5–0; Gann Limit Adopted (draft minutes: 5–0; recording: 4 ayes, Trustee Wells not called)',
        proposalStatusBadgeEs: 'Puntos de Acción — Cierre No Auditado Aprobado 5–0; Límite Gann Adoptado (borrador de actas: 5–0; grabación: 4 votos a favor, no se llamó al miembro Wells)',
        whatIsProposedEn:
          'Closes the 2025-26 fiscal year books prior to independent audit. The General Fund recorded $147.48M in operating revenues and $157.22M in expenditures—an operating deficit of $9.73M—offset by an $11.0M interfund transfer ("Transfers - RDA Negotiated Agreements", bringing total credited revenue to $158.48M). Ending General Fund balance rose $1.27M to $18.38M ($5.63M above Estimated Actuals because expenditures came in $9.54M under projection), leaving an ~4.0% reserve against the 3.0% state minimum. Resolution 10 sets the 2025-26 Gann Limit at $94,351,626.61 and projects $97,021,787.08 for 2026-27.',
        whatIsProposedEs:
          'Cierra los libros del año fiscal 2025-26 antes de la auditoría independiente. El Fondo General registró $147.48M en ingresos operativos y $157.22M en gastos —un déficit operativo de $9.73M— compensado por una transferencia entre fondos de $11.0M ("Acuerdos Negociados RDA", llevando el ingreso total contabilizado a $158.48M). El saldo final subió $1.27M hasta $18.38M ($5.63M mejor que lo estimado porque el gasto fue $9.54M menor a lo proyectado), dejando una reserva de ~4.0% frente al mínimo estatal del 3.0%. La Resolución 10 fija el Límite Gann 2025-26 en $94,351,626.61 y proyecta $97,021,787.08 para 2026-27.',
        whyItMattersEn:
          'The $1.27M fund-balance gain exists only because of the $11.0M interfund transfer (booked as "Transfers - RDA Negotiated Agreements"); without it the General Fund would have drawn down $9.73M. The gain over projection came mostly from spending $9.54M less than estimated, while revenues came in $3.91M lower.',
        whyItMattersEs:
          'El aumento de $1.27M en el saldo existe solo gracias a la transferencia entre fondos de $11.0M (registrada como "Transferencias - Acuerdos Negociados RDA"); sin ella, el Fondo General habría bajado $9.73M. La mejora frente a lo proyectado vino sobre todo de gastar $9.54M menos de lo estimado, mientras los ingresos fueron $3.91M menores.',
        baselineContext: {
          metricNameEn: 'FY 2025-26 General Fund Unaudited Actuals',
          metricNameEs: 'Resultados No Auditados del Fondo General AF 2025-26',
          censusDate: 'Fiscal Year Ended June 30, 2026',
          fiscalPeriod: 'FY 2025-26 Year-End Close (SACS Unaudited Actuals)',
          certificationStatus: 'unaudited-actuals-pending-december-audit',
          priorBaselineNoteEn:
            'Revenues appear as $147.48M before the $11.0M interfund transfer and $158.48M including the transfer. Other year-end funds: Fund 21 (Bond) $39.07M; Fund 35 (County School Facilities) $22.54M; Fund 40 (Capital Outlay) $7.57M.',
          priorBaselineNoteEs:
            'Los ingresos figuran como $147.48M antes de la transferencia de $11.0M y como $158.48M incluyéndola. Otros fondos al cierre: Fondo 21 (Bonos) $39.07M; Fondo 35 $22.54M; Fondo 40 $7.57M.',
        },
        citations: [
          {
            labelEn: '2025-26 Unaudited Actuals SACS Financial Book',
            labelEs: 'Libro Financiero SACS de Resultados No Auditados 2025-26',
            filename: '25.26-Unaudited-Actuals-Book.pdf',
            pageRange: 'pp. 7–10 of 188 (executive summary; General Fund revenue and expenditure)',
            extractionStatus: 'text-extracted',
          },
          {
            labelEn: '2025-26 Unaudited Actuals Board Presentation (image slides; read by OCR)',
            labelEs: 'Presentación de Resultados No Auditados 2025-26 (diapositivas en imagen; leídas con OCR)',
            filename: '25-26-UA-Presentation.pdf',
            pageRange: 'pp. 1–14',
            extractionStatus: 'ocr-extracted',
          },
          {
            labelEn: 'Resolution No. 10 (Gann Appropriations Limit)',
            labelEs: 'Resolución N.º 10 (Límite de Apropiaciones Gann)',
            filename: 'Gann-Limit-Resolution-10-26.27.pdf',
            extractionStatus: 'text-extracted',
          },
        ],
      },
      {
        itemLabel: '6.1 & 11.1–11.3',
        titleEn: 'MTSS Attendance/Suspension Report (LCAP Goal 1) & Charter School Fiscal Oversight Letters (Connect, KIPP, Rocketship)',
        titleEs: 'Informe MTSS de Asistencia y Suspensiones (Meta 1 del LCAP) y Cartas de Supervisión Fiscal de Escuelas Chárter',
        actionType: 'Report / Information',
        allocatedMinutes: 36,
        proposalStatusBadgeEn: 'Oversight & LCAP Monitoring Reports',
        proposalStatusBadgeEs: 'Informes de Supervisión Chárter y Monitoreo LCAP',
        whatIsProposedEn:
          'Item 6.1 (35 minutes) reports chronic absenteeism as of September 9, 2026 at 9.11% as the deck states it (578 of 6,307 students; highest at McKinley 15%, lowest at Orion 4%). Information Items 11.1–11.3 publish RCSD’s fiscal oversight review letters on the 2026-27 Adopted Budgets and LCAPs of Connect, KIPP Excelencia, and Rocketship: Rocketship’s reserve is below the 5% MOU minimum in 2025-26 (4.48%) and 2026-27 (4.79%); Connect projects deficits in all three years, with fund balance falling from about 17% of expenditures to 3.69% by 2028-29, below the 5% minimum; KIPP also projects three years of deficits but keeps 17% or more; and the district found mismatches between each charter’s LCAP Budget Overview for Parents and its Adopted Budget.',
        whatIsProposedEs:
          'El Punto 6.1 (35 minutos) reporta un ausentismo crónico al 9 de septiembre de 2026 del 9.11%, según la presentación (578 de 6,307 estudiantes; el más alto en McKinley con 15% y el más bajo en Orion con 4%). Los Puntos 11.1–11.3 publican las cartas de supervisión fiscal de RCSD sobre Connect, KIPP Excelencia y Rocketship: la reserva de Rocketship está por debajo del mínimo del 5% del MOU en 2025-26 (4.48%) y 2026-27 (4.79%); Connect proyecta déficits en los tres años, con un saldo que baja de cerca del 17% de los gastos al 3.69% en 2028-29, por debajo del mínimo del 5%; KIPP también proyecta tres años de déficit pero mantiene 17% o más; y el distrito encontró discrepancias entre el resumen presupuestario del LCAP para padres de cada escuela chárter y su presupuesto adoptado.',
        whyItMattersEn:
          'Surfaces early warning indicators on charter reserve compliance ahead of the 2026-27 charter oversight and renewal cycle (KIPP Excelencia submitted its renewal petition on September 21, 2026).',
        whyItMattersEs:
          'Destaca alertas tempranas sobre el cumplimiento de reservas financieras en las escuelas chárter autorizadas por el distrito, antes del ciclo de supervisión y renovación 2026-27 (KIPP Excelencia presentó su petición de renovación el 21 de septiembre de 2026).',
        citations: [
          {
            labelEn: 'MTSS Board Report (chronic absenteeism by school, p. 3)',
            labelEs: 'Informe MTSS a la Junta (ausentismo crónico por escuela, p. 3)',
            filename: 'MTSS-Board-Report-26.09.23-Updated.pdf',
            pageRange: 'p. 3',
            extractionStatus: 'text-extracted',
          },
          {
            labelEn: 'Rocketship FY 2026-27 Adopted Budget Oversight Review Letter',
            labelEs: 'Carta de Supervisión Fiscal 2026-27 — Rocketship',
            filename: 'Rocketship-FY-2026-27-Adopted-Budget-Review-Letter.pdf',
            pageRange: 'pp. 2–5',
            extractionStatus: 'text-extracted',
          },
          {
            labelEn: 'Connect FY 2026-27 Adopted Budget Oversight Review Letter',
            labelEs: 'Carta de Supervisión Fiscal 2026-27 — Connect',
            filename: 'Connect-FY-2026-27-Adopted-Budget-Review-Letter.pdf',
            pageRange: 'pp. 2–5',
            extractionStatus: 'text-extracted',
          },
          {
            labelEn: 'KIPP Excelencia FY 2026-27 Adopted Budget Oversight Review Letter',
            labelEs: 'Carta de Supervisión Fiscal 2026-27 — KIPP Excelencia',
            filename: 'KIPP-FY-2026-27-Adopted-Budget-Review-Letter.pdf',
            pageRange: 'pp. 2–5',
            extractionStatus: 'text-extracted',
          },
        ],
      },
      {
        itemLabel: '9.1',
        titleEn: '2026–27 Annual Enrollment and Capacity Review & Next Steps for Facility and Program Planning',
        titleEs: 'Revisión Anual de Matrícula y Capacidad 2026–27 y Próximos Pasos para la Planificación de Instalaciones y Programas',
        actionType: 'Action',
        allocatedMinutes: 35,
        proposalStatusBadgeEn: 'Action Item — Approved 5–0 (Roll-Call Vote)',
        proposalStatusBadgeEs: 'Punto de Acción — Aprobado 5–0 (Votación Nominal)',
        whatIsProposedEn:
          'Reviews Day-10 enrollment (6,199 students) against total physical facility capacity (12,362 seats, ~50% utilization). Utilization is lowest at Garfield (18%), Taft (28%), and Roosevelt/McKinley (32% each), and highest at North Star (90%) and Orion (79%, using 25 of 29 classrooms and needing 27 in 2027-28). Approves Superintendent Dr. Rubalcaba’s recommended two-track study process—one on Bayside capacity and middle-school access, and one on Orion and small schools—returning for Board action in December 2027 or January 2028 for Fall 2028-29 implementation.',
        whatIsProposedEs:
          'Analiza la matrícula al Día 10 (6,199 estudiantes) frente a la capacidad física total (12,362 lugares, ~50% de utilización). La ocupación más baja está en Garfield (18%), Taft (28%) y Roosevelt/McKinley (32% cada una), y la más alta en North Star (90%) y Orion (79%, que usa 25 de 29 aulas y necesitará 27 en 2027-28). Aprueba los dos estudios recomendados por el Superintendente Dr. Rubalcaba —uno sobre capacidad en Bayside y acceso a secundaria, y otro sobre Orion y escuelas pequeñas— con decisión de la Junta prevista entre diciembre de 2027 y enero de 2028 para implementarse en otoño de 2028-29.',
        whyItMattersEn:
          'Sets the official multi-year timeline for potential grade reconfigurations (including community requests for K–8 at Garfield) and relieving classroom pressure at Orion.',
        whyItMattersEs:
          'Establece el cronograma oficial para evaluar posibles reconfiguraciones de grados (incluidas las solicitudes comunitarias para ampliar Garfield hasta 8.º grado) y aliviar la falta de espacio en Orion.',
        baselineContext: {
          metricNameEn: 'Day-10 Enrollment vs. Gross Facility Capacity',
          metricNameEs: 'Matrícula al Día 10 frente a Capacidad Física Total',
          censusDate: '2026-27 Day-10 Count (6,199 students)',
          fiscalPeriod: 'SY 2026-27 Planning for SY 2028-29 Implementation',
          certificationStatus: 'day-10-operational-count',
          priorBaselineNoteEn:
            'Day-10 count (6,199, as of August 26) precedes the preliminary October Census Day count (6,399, reported on 10/28). Capacity (12,362) is gross facility capacity across 12 operating schools. The board memo’s rationale gives 6,175 students and 12,278 capacity; the brief uses the updated deck’s figures.',
          priorBaselineNoteEs:
            'El conteo al Día 10 (6,199, al 26 de agosto) precede al conteo preliminar del Día del Censo de octubre (6,399, reportado el 28/10). La capacidad (12,362) es la capacidad bruta de las 12 escuelas en operación. La justificación del memorando indica 6,175 estudiantes y una capacidad de 12,278; este resumen usa las cifras de la presentación actualizada.',
        },
        citations: [
          {
            labelEn: '2026-27 Annual Enrollment & Capacity Review Deck (Updated 9/23/26)',
            labelEs: 'Presentación de Matrícula y Capacidad 2026-27 (Actualizada 23/09/26)',
            filename: '2026-27-Enrollment-Capacity-Review-26.09.23.-updated.pdf',
            pageRange: 'pp. 1–15',
            extractionStatus: 'text-extracted',
          },
        ],
      },
    ],
    consentScreening: {
      totalConsentItems: 16,
      thresholdUsd: 50000,
      spotlightItems: [
        {
          itemLabel: '8.7',
          titleEn: 'Air Education Inc. Virtual Reading Tutoring Services Agreement (SY 2026-27)',
          titleEs: 'Acuerdo con Air Education Inc. para Servicios de Tutoría Virtual de Lectura (2026-27)',
          amountDisplay: '$204,375.00',
          fundingSourceEn: 'LCAP $138,813; Learning Recovery Emergency Block Grant $55,562; Title III $10,000',
          fundingSourceEs: 'LCAP $138,813; Subvención en Bloque de Emergencia para Recuperación del Aprendizaje $55,562; Título III $10,000',
          flags: ['financial-threshold'],
          summaryEn:
            'Live small-group (1:3) virtual reading intervention in after-school programs for 125 students in grades 2–7 reading one to three years below grade level at Taft, Garfield, Hoover, Roosevelt, and McKinley: four days a week for 20 weeks during 2026-27.',
          summaryEs:
            'Intervención virtual de lectura en vivo, en grupos pequeños (1:3), dentro de los programas después de clases, para 125 estudiantes de 2.º a 7.º grado que leen de uno a tres años por debajo de su grado en Taft, Garfield, Hoover, Roosevelt y McKinley: cuatro días por semana durante 20 semanas en 2026-27.',
          citations: [
            {
              labelEn: 'Air Education 2026-27 Agreement',
              labelEs: 'Contrato Air Education 2026-27',
              filename: 'Air-Education-2026.27-Board-9.23.26_.pdf',
              extractionStatus: 'text-extracted',
            },
          ],
        },
        {
          itemLabel: '8.2',
          titleEn: 'Measure U Addendum 1 — Kennedy Middle School Site Plan ($195,228 Allocation Re-Budgeted)',
          titleEs: 'Adenda 1 de la Medida U — Plan Escolar de Kennedy Middle School (Reasignación de $195,228)',
          amountDisplay: '$195,228.00 total allocation ($85,000 reallocated)',
          fundingSourceEn: 'Measure U Parcel Tax',
          fundingSourceEs: 'Impuesto Parcelario Medida U',
          flags: ['financial-threshold', 'contract-amendment-or-change-order', 'charter-or-parcel-tax'],
          summaryEn:
            'Keeps Kennedy’s total 2026-27 Measure U allocation at $195,228 but moves the $85,000 STEAM teacher line to a guest teacher ($40,000), the community school coordinator ($25,000), Caminar counseling ($17,030), PBIS ($2,489), and school clubs (+$481, to $25,481). Kennedy’s School Site Council approved the addendum on September 1, 2026.',
          summaryEs:
            'Mantiene la asignación total de la Medida U de Kennedy en $195,228, pero pasa la partida de $85,000 del maestro STEAM a un maestro suplente ($40,000), el coordinador de escuela comunitaria ($25,000), consejería de Caminar ($17,030), PBIS ($2,489) y clubes escolares (+$481, hasta $25,481). El Consejo Escolar de Kennedy aprobó la adenda el 1 de septiembre de 2026.',
          citations: [
            {
              labelEn: 'Kennedy Middle School 2026-27 Measure U Addendum 1 (Scanned PDF — memo figures)',
              labelEs: 'Adenda 1 Medida U 2026-27 — Kennedy Middle School (PDF escaneado; cifras del memorando)',
              filename: '2026_27-Measure-U-Addendum-1_-Kennedy.pdf',
              extractionStatus: 'scanned-memo-fallback',
            },
          ],
        },
        {
          itemLabel: '8.8',
          titleEn: 'Amergis Healthcare Staffing First Amendment (Two Behavior Technicians)',
          titleEs: 'Primera Enmienda con Amergis Healthcare Staffing (Dos Técnicos de Conducta)',
          amountDisplay: '+$142,920.00 (New contract total: $294,920.00)',
          fundingSourceEn: 'Unduplicated Pupil Services',
          fundingSourceEs: 'Servicios para Alumnos No Duplicados',
          flags: ['financial-threshold', 'contract-amendment-or-change-order'],
          summaryEn:
            'Adds two behavior technicians (+$142,920), supervised by the contracted Amergis BCBA, to support classrooms the BCBA identifies, as part of the LCAP push to reduce suspensions; the contract ceiling rises from $152,000 to $294,920.',
          summaryEs:
            'Agrega dos técnicos de conducta (+$142,920), supervisados por el analista de conducta (BCBA) contratado con Amergis, para apoyar los salones que el BCBA identifique, como parte del esfuerzo del LCAP para reducir las suspensiones; el monto máximo del contrato sube de $152,000 a $294,920.',
          citations: [
            {
              labelEn: 'Amergis First Amendment (9/23/26)',
              labelEs: 'Primera Enmienda Amergis (23/09/26)',
              filename: 'Amergis-Amendment-26.27-Board-9.23.26.pdf',
              extractionStatus: 'text-extracted',
            },
          ],
        },
        {
          itemLabel: '8.10',
          titleEn: 'Siemens Industry, Inc. Fire and Life Safety Inspection & Testing Renewal (FY 2026-27)',
          titleEs: 'Renovación con Siemens Industry, Inc. para Inspección y Pruebas contra Incendios (AF 2026-27)',
          amountDisplay: '$97,224.00',
          fundingSourceEn: '2026-27 Facilities/Maintenance Fund',
          fundingSourceEs: 'Fondo de Instalaciones y Mantenimiento 2026-27',
          flags: ['financial-threshold'],
          summaryEn:
            'One-year renewal (July 1, 2026 – June 30, 2027, retroactive to July 1) for required fire alarm inspections at 17 sites, sprinkler testing at 14 sites, and kitchen hood suppression inspections at Roosevelt, McKinley, and Hoover.',
          summaryEs:
            'Renovación de un año (1 de julio de 2026 – 30 de junio de 2027, retroactiva al 1 de julio) para las inspecciones obligatorias de alarmas contra incendios en 17 sitios, pruebas de rociadores en 14 sitios e inspecciones de sistemas de supresión en campanas de cocina en Roosevelt, McKinley y Hoover.',
          citations: [
            {
              labelEn: 'Siemens Fire & Life Safety Renewal Agreement (2026-27)',
              labelEs: 'Contrato de Renovación Siemens (2026-27)',
              filename: 'Redwood-City-School-District-Renewal-26-27-1-5.pdf',
              extractionStatus: 'text-extracted',
            },
          ],
        },
        {
          itemLabel: '8.11',
          titleEn: 'UniFirst Uniform Rental and Laundry Services Renewal (3 years, Aug 2026 – Jul 2029)',
          titleEs: 'Renovación con UniFirst para Alquiler y Lavandería de Uniformes (3 años, ago. 2026 – jul. 2029)',
          amountDisplay: '$125,431.00 estimated 3-year total ($39,787.80 in Year 1)',
          fundingSourceEn: 'Facilities operating budget',
          fundingSourceEs: 'Presupuesto operativo de Instalaciones',
          flags: ['financial-threshold'],
          summaryEn:
            'Renews uniform rental and laundry for Operations, Maintenance, Grounds, Warehouse, and Transportation staff on a negotiated 36-month term (instead of UniFirst’s standard 60 months): a $765.15 minimum weekly charge, down from about $1,475 a week, no increase until August 2027, and later increases capped at 5% a year. The attached agreement is a scan; figures are from the board memo.',
          summaryEs:
            'Renueva el alquiler y lavado de uniformes para el personal de Operaciones, Mantenimiento, Jardinería, Almacén y Transporte con un plazo negociado de 36 meses (en lugar de los 60 meses estándar de UniFirst): un cargo semanal mínimo de $765.15, frente a unos $1,475 por semana antes, sin aumentos hasta agosto de 2027 y con aumentos posteriores limitados al 5% anual. El contrato adjunto es un escaneo; las cifras provienen del memorando.',
          citations: [
            {
              labelEn: 'UniFirst Revised Agreement (Scanned PDF — memo figures)',
              labelEs: 'Contrato Revisado UniFirst (PDF escaneado; cifras del memorando)',
              filename: 'UniFirst-Revised-Agreement_Board-9.23.26.pdf',
              extractionStatus: 'scanned-memo-fallback',
            },
          ],
        },
        {
          itemLabel: '8.12–8.16',
          titleEn: 'Board Bylaws 9250 (Trustee Remuneration Fixed at $1,200/mo) & 9320 (Meetings and Notices) + Policies 4140/4240/4340 (Bargaining Units)',
          titleEs: 'Estatutos de la Junta 9250 (Remuneración Fijada en $1,200/mes) y 9320 (Reuniones y Avisos) + Políticas 4140/4240/4340 (Unidades Sindicales)',
          amountDisplay: 'Governance & Trustee Compensation Bylaw Update',
          fundingSourceEn: 'None stated (memos: no financial impact at this time)',
          fundingSourceEs: 'No se indica (memorandos: sin impacto financiero por ahora)',
          flags: ['policy-or-bylaw-revision'],
          summaryEn:
            'Revises Board Bylaw 9250 to replace "may receive the maximum monthly compensation" under Ed Code 35120 with monthly compensation of $1,200, less deductions for unexcused absences (noting trustees are not required to accept it), updates BB 9320 (Meetings and Notices), and updates BP 4140/4240/4340 (Bargaining Units).',
          summaryEs:
            'Modifica el Estatuto 9250 de la Junta para reemplazar "puede recibir la compensación mensual máxima" bajo el Código de Educación 35120 por una compensación mensual de $1,200, menos descuentos por ausencias no justificadas (aclarando que los miembros no están obligados a aceptarla), actualiza el Estatuto 9320 (Reuniones y Avisos) y las Políticas 4140/4240/4340 (Unidades de Negociación).',
          citations: [
            {
              labelEn: 'Board Bylaw 9250 Remuneration, Reimbursement & Other Benefits (Marked Redline)',
              labelEs: 'Estatuto 9250 Remuneración y Beneficios (Versión Marcada)',
              filename: 'BB-9250-Remuneration-Reimbursement-And-Other-Benefits-Marked.pdf',
              extractionStatus: 'text-extracted',
            },
          ],
        },
      ],
      routineSummaryEn:
        'The remaining 6 consent items cover: draft September 9 minutes (8.1), three Outdoor Education field trips for Clifford, Orion, and North Star (8.3–8.5), the 2026–2029 Stanford Teacher Education Program (STEP) student-teacher placement agreement (8.6), and a 36-month Sourcewell agreement with Motive Technologies for fleet cameras and telematics across 16 school buses, not to exceed $39,673.97 (8.9).',
      routineSummaryEs:
        'Los 6 puntos de consentimiento restantes cubren: el borrador de actas del 9 de septiembre (8.1), tres excursiones de Educación al Aire Libre para Clifford, Orion y North Star (8.3–8.5), el convenio 2026–2029 con la Universidad de Stanford (STEP) para prácticas docentes (8.6) y un contrato de 36 meses con Motive Technologies, vía Sourcewell, para cámaras y telemática en 16 autobuses escolares, hasta por $39,673.97 (8.9).',
      extractionNotes: [
        {
          itemLabel: '8.2 & 8.11',
          noteEn:
            'Scanned PDFs detected: Kennedy’s Measure U Addendum 1 (Item 8.2) and the UniFirst revised agreement (Item 8.11) are image scans without embedded text layers. Their figures ($195,228 and the line-item reallocations; $125,431 and $39,787.80) are taken from the structured Simbli board memo.',
          noteEs:
            'PDFs escaneados detectados: la Adenda 1 de la Medida U de Kennedy (Punto 8.2) y el contrato revisado de UniFirst (Punto 8.11) son imágenes escaneadas sin capa de texto. Sus cifras ($195,228 y las reasignaciones por partida; $125,431 y $39,787.80) provienen del memorando oficial en Simbli.',
        },
        {
          itemLabel: '11.4',
          noteEn:
            'External links: The August 2026 San Mateo County Investment Fund and Compliance Reports link externally to smcgov.org.',
          noteEs:
            'Enlaces externos: Los Informes del Fondo de Inversión del Condado de San Mateo de agosto de 2026 enlazan externamente a smcgov.org.',
        },
      ],
    },
  },
};

async function buildBriefForDate(date) {
  const base = REVIEWED_BRIEFS[date];
  if (!base) {
    throw new Error(`No reviewed docket brief definition found for ${date}`);
  }
  const meeting = getMeetingByDate(date);
  const memo = getMemoByDate(date, 'en');
  const memoEs = getMemoByDate(date, 'es');

  // Run automated consent screener to cross-verify against curated spotlight
  const autoConsent = meeting && memo ? screenConsentCalendar(meeting, memo, memoEs, aidToR2Path) : null;

  const topItems = [];
  for (const item of base.topItems) {
    const citations = await enrichCitationArtifacts(ROOT, date, item.citations);
    topItems.push({
      ...item,
      citations,
    });
  }

  const spotlightItems = [];
  for (const sp of base.consentScreening.spotlightItems) {
    const citations = await enrichCitationArtifacts(ROOT, date, sp.citations);
    spotlightItems.push({
      ...sp,
      citations,
    });
  }

  const simbliUrl =
    meeting?.simbli ||
    (meeting?.mid ? `https://simbli.eboardsolutions.com/SB_Meetings/ViewMeeting.aspx?S=36030397&MID=${meeting.mid}` : 'https://simbli.eboardsolutions.com/SB_Meetings/SB_MeetingListing.aspx?S=36030397');

  const doc = {
    _metadata: {
      source: simbliUrl,
      triageSource: `data/triage/${date}.md`,
      memoSource: `data/board-memos/${date}.json`,
      scrapedAt: memo?.scrapedAt || meeting?.scrapedAt || new Date().toISOString(),
      generatedAt: REVIEWED_AT,
      method:
        'Packet-verified bilingual synthesis combining scripts/lib/agenda-weight.mjs time-ranking, scripts/lib/docket-brief.mjs 100% consent-calendar screening, and human-reviewed packet triage notes.',
      reviewStatus: base.qualityState,
    },
    date: base.date,
    meetingSlug: base.meetingSlug,
    meetingStage: base.meetingStage,
    qualityState: base.qualityState,
    overviewEn: base.overviewEn,
    overviewEs: base.overviewEs,
    scheduleChangesNoteEn: base.scheduleChangesNoteEn || null,
    scheduleChangesNoteEs: base.scheduleChangesNoteEs || null,
    topItems,
    consentScreening: {
      totalConsentItems: autoConsent ? autoConsent.totalConsentItems : base.consentScreening.totalConsentItems,
      thresholdUsd: base.consentScreening.thresholdUsd,
      automatedFlaggedCount: autoConsent ? autoConsent.flaggedItems.length : spotlightItems.length,
      spotlightItems,
      reviewedExceptions: base.consentScreening.reviewedExceptions || [],
      routineSummaryEn: base.consentScreening.routineSummaryEn,
      routineSummaryEs: base.consentScreening.routineSummaryEs,
      extractionNotes: base.consentScreening.extractionNotes || [],
    },
  };

  // Ground the brief in its meeting: citations must name archived attachments,
  // Simbli links must carry this meeting's MID, and every automated consent
  // flag must be spotlighted or explicitly excepted.
  if (!memo) throw new Error(`Missing data/board-memos/${date}.json; cannot verify citations`);
  const validation = validateDocketBrief(doc, {
    attachmentFilenames: attachmentInventory(memo),
    meetingMid: memo.mid ?? meeting?.mid ?? null,
    automatedFlags: autoConsent ? autoConsent.flaggedItems : null,
  });
  if (!validation.valid) {
    const msg = validation.errors.map((e) => `${e.path}: ${e.message}`).join('; ');
    throw new Error(`Invalid docket brief for ${date}: ${msg}`);
  }

  return doc;
}

async function main() {
  const outDir = resolve(ROOT, 'data/docket-briefs');
  mkdirSync(outDir, { recursive: true });

  const dates = Object.keys(REVIEWED_BRIEFS).sort().reverse();
  const indexEntries = [];

  for (const date of dates) {
    const brief = await buildBriefForDate(date);
    const outPath = resolve(outDir, `${date}.json`);
    writeFileSync(outPath, JSON.stringify(brief, null, 2) + '\n');
    indexEntries.push({
      date: brief.date,
      meetingSlug: brief.meetingSlug,
      meetingStage: brief.meetingStage,
      qualityState: brief.qualityState,
      topItemsCount: brief.topItems.length,
      consentTotalCount: brief.consentScreening.totalConsentItems,
      consentSpotlightCount: brief.consentScreening.spotlightItems.length,
      path: `data/docket-briefs/${date}.json`,
    });
    console.log(
      `[+] data/docket-briefs/${date}.json (${brief.topItems.length} top items, ${brief.consentScreening.spotlightItems.length}/${brief.consentScreening.totalConsentItems} consent items spotlighted)`
    );
  }

  const indexDoc = {
    _metadata: {
      source: 'https://simbli.eboardsolutions.com/SB_Meetings/SB_MeetingListing.aspx?S=36030397',
      scrapedAt: '2026-10-29T20:45:00Z',
      method: 'Compiled by scripts/generate-docket-brief.mjs from reviewed packet digests.',
    },
    briefs: indexEntries,
  };
  const indexPath = resolve(outDir, 'index.json');
  writeFileSync(indexPath, JSON.stringify(indexDoc, null, 2) + '\n');
  console.log(`[+] data/docket-briefs/index.json (${indexEntries.length} briefs indexed)`);

  // Emit v1 dataset provenance sidecar in data/provenance/rcsd.docket-briefs.json
  const artifacts = [];
  for (const date of dates) {
    const p = resolve(outDir, `${date}.json`);
    artifacts.push({
      path: `data/docket-briefs/${date}.json`,
      mediaType: 'application/json',
      hash: await hashFile(p),
      bytes: statSync(p).size,
    });
  }
  artifacts.push({
    path: 'data/docket-briefs/index.json',
    mediaType: 'application/json',
    hash: await hashFile(indexPath),
    bytes: statSync(indexPath).size,
  });

  const sources = [];
  for (const date of dates) {
    const meeting = getMeetingByDate(date);
    const memoPath = resolve(ROOT, `data/board-memos/${date}.json`);
    const simbliUrl =
      meeting?.simbli ||
      (meeting?.mid
        ? `https://simbli.eboardsolutions.com/SB_Meetings/ViewMeeting.aspx?S=36030397&MID=${meeting.mid}`
        : 'https://simbli.eboardsolutions.com/SB_Meetings/SB_MeetingListing.aspx?S=36030397');
    sources.push({
      sourceId: `rcsd.simbli.memo.${date}`,
      title: `RCSD Board Packet & Agenda Memo (${date})`,
      publisher: 'Redwood City School District (Simbli / GAMUT)',
      url: simbliUrl,
      acquiredAt: '2026-10-29T20:45:00Z',
      effectiveAt: date,
      hash: await hashFile(memoPath),
      snapshot: {
        path: `data/board-memos/${date}.json`,
        mediaType: 'application/json',
        hash: await hashFile(memoPath),
        bytes: statSync(memoPath).size,
      },
    });
  }

  const provenanceDoc = {
    $schema: 'https://rcsd.info/schemas/provenance/v1/dataset-provenance.schema.json',
    schemaVersion: '1.0.0',
    datasetId: 'rcsd.docket-briefs',
    districtId: 'ca.cde.district.4169005',
    kind: 'derived',
    artifacts,
    authority: {
      status: 'derived',
      officialLanguage: 'en-US',
      notes:
        'Bilingual (EN/ES) pre-meeting packet digests and 100% consent-calendar screenings derived from official Simbli board memos and board packet PDFs.',
    },
    reportingPeriod: {
      from: dates[dates.length - 1],
      to: dates[0],
      label: '2026-27 RCSD Board Meetings',
    },
    sources,
    lineage: {
      generatedAt: REVIEWED_AT,
      generator: {
        script: 'scripts/generate-docket-brief.mjs',
        version: await hashFile(__filename),
      },
      inputs: sources.map((s) => ({
        sourceId: s.sourceId,
        artifactPath: s.snapshot.path,
        hash: s.hash,
      })),
    },
    quality: {
      state: 'human-reviewed',
      checkedAt: REVIEWED_AT,
      exceptions: [
        {
          code: 'scanned-pdf-memo-fallback',
          message:
            'On 2026-10-28, Item 6.1 DSA/PG&E fee receipts and Item 10.4 KIPP Measure U application are image scans; dollar figures ($69,089.12 and $156,326.00) are verified from the structured Simbli memo. On 2026-09-23, Item 8.2 Kennedy Measure U addendum and Item 8.11 UniFirst agreement are image scans; their figures come from the memo.',
        },
        {
          code: 'ocr-extracted',
          message:
            'On 2026-09-23, the Unaudited Actuals board presentation is image slides; its figures were read by OCR and cross-checked against the text-layer Unaudited Actuals book (pp. 7–10).',
        },
      ],
    },
  };

  const schemaCheck = validateJsonSchema('dataset', provenanceDoc);
  const domainCheck = validateDatasetProvenance(provenanceDoc);
  if (!schemaCheck.valid || !domainCheck.valid) {
    throw new Error(
      `Invalid rcsd.docket-briefs provenance: ${JSON.stringify([
        ...(schemaCheck.errors || []),
        ...(domainCheck.errors || []),
      ])}`
    );
  }
  const provOut = resolve(ROOT, 'data/provenance/rcsd.docket-briefs.json');
  writeFileSync(provOut, JSON.stringify(provenanceDoc, null, 2) + '\n');
  console.log('[+] data/provenance/rcsd.docket-briefs.json (v1 provenance verified)');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
