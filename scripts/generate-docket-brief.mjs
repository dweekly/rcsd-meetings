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
      'Two 35-minute staff reports anchor this Regular meeting: a Human Resources & Staffing Levels update carrying the district’s preliminary 2026-27 Census Day enrollment count (6,399 non-charter students, +90 over 2025-26 and +160 above the adopted budget projection), and an Integrated/Designated English Language Development (ELD) report covering 1,876 English learners. Meanwhile, the Consent Calendar carries over $3.99M in expanded-learning contracts, Measure U charter funds, bond HVAC fees, and 11 Board Policy revisions.',
    overviewEs:
      'Dos informes de personal de 35 minutos encabezan esta reunión ordinaria: una actualización de Recursos Humanos y Niveles de Personal que presenta el conteo preliminar del Día del Censo 2026-27 del distrito (6,399 estudiantes en escuelas no chárter, +90 respecto a 2025-26 y +160 por encima de lo proyectado en el presupuesto adoptado), y un informe sobre el Desarrollo del Idioma Inglés (ELD) Integrado y Designado que abarca a 1,876 estudiantes aprendices de inglés. Además, el Calendario de Consentimiento incluye más de $3.99 millones en contratos de aprendizaje extendido, fondos de la Medida U para escuelas chárter, tarifas de HVAC del bono y 11 revisiones de Políticas de la Junta.',
    scheduleChangesNoteEn:
      'Per the revised October 22 Schedule of Board Agenda Items (Item 15), the Connect, Rocketship, and KIPP 2025-26 unaudited actuals review letters moved from October 28 to November 4, 2026. No KIPP charter renewal decision date has been placed on the schedule yet (statutory 90-day deadline: December 20, 2026).',
    scheduleChangesNoteEs:
      'Según la revisión del 22 de octubre del Calendario de Temas de la Junta (Punto 15), las cartas de revisión de resultados no auditados 2025-26 de Connect, Rocketship y KIPP pasaron del 28 de octubre al 4 de noviembre de 2026. Aún no figura en el calendario la fecha de decisión sobre la renovación chárter de KIPP (plazo legal de 90 días: 20 de diciembre de 2026).',
    topItems: [
      {
        itemLabel: '9.1',
        titleEn: 'Human Resources and Staffing Levels Update',
        titleEs: 'Actualización sobre Recursos Humanos y Niveles de Dotación de Personal',
        actionType: 'Discussion',
        allocatedMinutes: 35,
        proposalStatusBadgeEn: 'Discussion Item — Preliminary Data (Uncertified)',
        proposalStatusBadgeEs: 'Punto de Discusión — Datos Preliminares (No Certificados)',
        whatIsProposedEn:
          'Staff presents a four-year General Fund staffing series (870.76 FTE in 2023-24 down to 785.26 FTE in 2026-27, a 9.8% reduction) alongside a preliminary, uncertified 2026-27 Census Day enrollment count of 6,399 non-charter students (412 TK and 5,987 K-8). General Fund salary and benefit totals rose from $113.53M to $123.59M budgeted in 2026-27 (excluding pending RCTA, RCAA, and CSEA collective bargaining settlements).',
        whatIsProposedEs:
          'El personal presenta una serie de cuatro años de dotación del Fondo General (de 870.76 FTE en 2023-24 a 785.26 FTE en 2026-27, una reducción del 9.8%) junto con un conteo preliminar no certificado del Día del Censo 2026-27 de 6,399 estudiantes en escuelas no chárter (412 en TK y 5,987 en K-8). Los salarios y beneficios del Fondo General pasaron de $113.53M a $123.59M presupuestados en 2026-27 (sin incluir los acuerdos laborales pendientes con RCTA, RCAA y CSEA).',
        whyItMattersEn:
          'The preliminary 6,399 enrollment count is 90 students higher than 2025-26 (6,309) and 160 students above the 6,239 assumed in the 2026-27 Adopted Budget. About two-thirds of the increase is in Transitional Kindergarten (350 → 412), with K-8 also up slightly (5,959 → 5,987). Certified figures will feed into the First Interim Budget on December 16, 2026.',
        whyItMattersEs:
          'El conteo preliminar de 6,399 estudiantes supera en 90 alumnos al de 2025-26 (6,309) y en 160 alumnos a los 6,239 proyectados en el Presupuesto Adoptado 2026-27. Cerca de dos tercios del aumento corresponden a Kínder de Transición (350 → 412), con un ligero aumento también en K-8 (5,959 → 5,987). Las cifras certificadas se incorporarán al Primer Informe Presupuestario Interino el 16 de diciembre de 2026.',
        baselineContext: {
          metricNameEn: '2026-27 Non-Charter Enrollment & General Fund FTE',
          metricNameEs: 'Matrícula No Chárter 2026-27 y Personal FTE del Fondo General',
          censusDate: '2026-10-07 (Preliminary Census Day)',
          fiscalPeriod: 'FY 2026-27 (Adopted Budget vs. Preliminary Oct 2026)',
          certificationStatus: 'preliminary-uncertified',
          priorBaselineNoteEn:
            'Compared against 2025-26 HR deck baseline of 6,309 students and 2026-27 Adopted Budget projection of 6,239. Note: Item 8.1 (ELD deck) cites a 2025-26 denominator of 6,276 students.',
          priorBaselineNoteEs:
            'Comparado con la base de 6,309 estudiantes de RR. HH. en 2025-26 y la proyección de 6,239 del Presupuesto Adoptado 2026-27. Nota: El Punto 8.1 (presentación ELD) cita un total de 6,276 estudiantes para 2025-26.',
        },
        citations: [
          {
            labelEn: 'HR and Staffing Levels Presentation (Slides 1–14)',
            labelEs: 'Presentación de Recursos Humanos y Niveles de Personal (Diapositivas 1–14)',
            filename: 'HR-Staffing-Levels-Presentation.pdf',
            pageRange: 'pp. 1–14',
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
          'Educational Services reports on instructional coaching, professional development, and outcomes for RCSD’s 1,876 English learners (30% of the 6,276 students cited in the ELD deck). English Learner Progress Indicator (ELPI) rose to 41.9% in 2025-26, up from 38.7% (2023-24) and 41.6% (2024-25), against an LCAP Goal 2 target of 55% by June 2027.',
        whatIsProposedEs:
          'Servicios Educativos informa sobre la capacitación docente y los resultados de los 1,876 estudiantes aprendices de inglés de RCSD (30% de los 6,276 estudiantes citados en la presentación). El Indicador de Progreso de Aprendices de Inglés (ELPI) subió a 41.9% en 2025-26, frente a 38.7% (2023-24) y 41.6% (2024-25), hacia la meta del LCAP del 55% para junio de 2027.',
        whyItMattersEn:
          'Nearly one in three RCSD students is an English learner. While ELPI improved by 0.3 percentage points over last year, closing the remaining 13.1-point gap to the June 2027 LCAP target of 55% requires accelerated site-level reclassification and designated ELD support.',
        whyItMattersEs:
          'Casi uno de cada tres estudiantes de RCSD aprende inglés. Aunque el indicador ELPI mejoró 0.3 puntos porcentuales respecto al año pasado, alcanzar la meta del 55% fijada en el LCAP para junio de 2027 requiere acelerar la reclasificación y el apoyo ELD por escuela.',
        baselineContext: {
          metricNameEn: 'English Learner Progress Indicator (ELPI) & Reclassification',
          metricNameEs: 'Indicador de Progreso de Aprendices de Inglés (ELPI) y Reclasificación',
          censusDate: '2025-26 School Year (ELPAC / Dashboard series)',
          fiscalPeriod: 'LCAP 3-Year Cycle (2024-25 through 2026-27)',
          certificationStatus: 'district-reported-series',
          priorBaselineNoteEn:
            '38.7% (2023-24) → 41.6% (2024-25) → 41.9% (2025-26) vs. 55.0% June 2027 LCAP target.',
          priorBaselineNoteEs:
            '38.7% (2023-24) → 41.6% (2024-25) → 41.9% (2025-26) frente a la meta del 55.0% del LCAP para junio de 2027.',
        },
        citations: [
          {
            labelEn: 'Integrated & Designated ELD Board Report Deck',
            labelEs: 'Presentación de Desarrollo del Idioma Inglés (ELD)',
            filename: 'RCSD_Board_ELD_Oct2026.pptx-1.pdf',
            pageRange: 'pp. 1–18',
            extractionStatus: 'text-extracted',
          },
        ],
      },
      {
        itemLabel: '11.1–11.2',
        titleEn: 'Resolutions No. 12 (PremierOne Authorised Signatory) & No. 13 (Education Code Teaching Assignments)',
        titleEs: 'Resoluciones N.º 12 (Firmante Autorizado en PremierOne) y N.º 13 (Asignaciones Docentes según el Código de Educación)',
        actionType: 'Action',
        allocatedMinutes: 10,
        proposalStatusBadgeEn: 'Proposed Action — Roll-Call Vote Required',
        proposalStatusBadgeEs: 'Acción Propuesta — Requiere Votación Nominal',
        whatIsProposedEn:
          'Resolution 12 adds the interim administrative assistant to the Superintendent as an authorized signatory on the PremierOne Revolving Cash Account during a staff leave. Resolution 13 authorizes certificated teaching assignments outside primary credential subject areas for 2026-27 under Education Code options with teacher consent (Exhibit A).',
        whatIsProposedEs:
          'La Resolución 12 agrega al asistente administrativo interino del Superintendente como firmante autorizado en la cuenta rotativa de PremierOne durante una licencia laboral. La Resolución 13 autoriza asignaciones docentes certificadas para 2026-27 bajo opciones del Código de Educación con consentimiento del maestro (Anexo A).',
        whyItMattersEn:
          'These are the two standalone Open Session roll-call action items on the October 28 agenda; all major financial contracts and policy revisions are bundled on the Consent Calendar below.',
        whyItMattersEs:
          'Estos son los dos únicos puntos de acción individual en sesión pública del 28 de octubre; todos los contratos financieros mayores y las revisiones de políticas están agrupados en el Calendario de Consentimiento a continuación.',
        citations: [
          {
            labelEn: 'Resolution No. 12 (PremierOne Revolving Cash Signatory)',
            labelEs: 'Resolución N.º 12 (Firmante Autorizado PremierOne)',
            filename: 'Resolution-No.-12-Adding-Authorized-Signatory.pdf',
            pageRange: 'p. 1',
            extractionStatus: 'text-extracted',
          },
          {
            labelEn: 'Resolution No. 13 + Exhibit A (Ed Code Teaching Assignments)',
            labelEs: 'Resolución N.º 13 + Anexo A (Asignaciones Docentes)',
            filename: 'Resolution-13-Ed-Code-Teaching-Assignment-2026-2027-oct.pdf',
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
            'Funds after-school and summer 2027 REACH programming at Henry Ford, Roosevelt, Adelante Selby, and Orion.',
          summaryEs:
            'Financia el programa REACH después de clases y en el verano de 2027 en Henry Ford, Roosevelt, Adelante Selby y Orion.',
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
          fundingSourceEn: 'ELO-P / Restricted Categorical Funds',
          fundingSourceEs: 'Fondos Categóricos Restringidos / ELO-P',
          flags: ['financial-threshold'],
          summaryEn:
            'Provides small-group academic tutoring across seven RCSD school sites during the 2026-27 school year.',
          summaryEs:
            'Brinda tutoría académica en grupos pequeños en siete escuelas de RCSD durante el año escolar 2026-27.',
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
            'Supplemental charter bus services for student transportation and field trips during 2026-27.',
          summaryEs:
            'Servicios suplementarios de autobuses para transporte estudiantil y excursiones durante 2026-27.',
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
            'Covers closeout DSA fees on Phase 1 (Roosevelt, Taft), a $3,500 PG&E engineering advance for Clifford (Phase 2), and $16,760 DSA filing fees each for Roy Cloud and Henry Ford to enter Phase 3 DSA review. Attached fee receipts are scans; figures are verified from the board memo.',
          summaryEs:
            'Cubre tarifas adicionales de DSA en la Fase 1 (Roosevelt, Taft), un anticipo de ingeniería de PG&E de $3,500 para Clifford (Fase 2) y $16,760 en tarifas de presentación ante DSA para Roy Cloud y Henry Ford (Fase 3). Los recibos PDF son escaneos; las cifras provienen del memorando.',
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
          fundingSourceEn: 'Facilities / Routine Restricted Maintenance Fund',
          fundingSourceEs: 'Fondo de Mantenimiento e Instalaciones',
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
        itemLabel: '8.1',
        titleEn: 'Public Hearing: KIPP Excelencia Charter Renewal Petition (July 1, 2027 – June 30, 2032)',
        titleEs: 'Audiencia Pública: Petición de Renovación Chárter de KIPP Excelencia (1 de julio de 2027 – 30 de junio de 2032)',
        actionType: 'Public Hearing',
        allocatedMinutes: 30,
        proposalStatusBadgeEn: 'Public Hearing Only — Statutory Decision Due by Dec 20, 2026',
        proposalStatusBadgeEs: 'Solo Audiencia Pública — Decisión Legal Antes del 20 de Dic. de 2026',
        whatIsProposedEn:
          'KIPP Excelencia Community Prep submitted its complete renewal petition on September 21, 2026 requesting a five-year term (July 1, 2027 – June 30, 2032) in the California Department of Education’s "middle performing" renewal tier. Under Education Code § 47605(b), this October 14 item is the initial public hearing to receive community testimony; no grant-or-deny vote is on this agenda.',
        whatIsProposedEs:
          'KIPP Excelencia Community Prep presentó su petición completa de renovación el 21 de septiembre de 2026 solicitando un periodo de cinco años (1 de julio de 2027 – 30 de junio de 2032) dentro de la categoría de desempeño medio ("middle performing") del Departamento de Educación de California (CDE). Bajo el Código de Educación § 47605(b), este punto es la audiencia pública inicial; no hay votación de aprobación o rechazo en esta sesión.',
        whyItMattersEn:
          'Receipt of the petition on September 21 triggered a 90-day statutory clock under Ed Code 47605(b), requiring Board action to grant or deny by December 20, 2026 (unless extended by 30 days by mutual agreement). KIPP projects operating deficits through 2028-29 while maintaining a 17%+ reserve (above the 5% MOU floor).',
        whyItMattersEs:
          'La recepción de la petición el 21 de septiembre activó el plazo legal de 90 días bajo el Código de Educación 47605(b), que exige una decisión de la Junta a más tardar el 20 de diciembre de 2026 (salvo prórroga mutua de 30 días). KIPP proyecta déficits operativos hasta 2028-29 pero mantiene reservas superiores al 17% (por encima del mínimo del 5% en el MOU).',
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
            labelEn: 'KIPP Excelencia Charter Renewal Petition 2027–2032 (Full Packet)',
            labelEs: 'Petición Completa de Renovación Chárter de KIPP Excelencia 2027–2032',
            filename: 'KIPP-Excelencia-Charter-Renewal-Petition-2027-2032.pdf',
            pageRange: 'pp. 1–120',
            extractionStatus: 'text-extracted',
          },
          {
            labelEn: 'KIPP Excelencia Public Hearing Presentation Deck',
            labelEs: 'Presentación de Audiencia Pública de KIPP Excelencia',
            filename: 'KIPP-Excelencia-Public-Hearing-Presentation-10.14.26.pdf',
            pageRange: 'pp. 1–20',
            extractionStatus: 'text-extracted',
          },
        ],
      },
      {
        itemLabel: '9.1',
        titleEn: 'Update on the Redwood City School District Health and Wellness Department',
        titleEs: 'Actualización sobre el Departamento de Salud y Bienestar de RCSD',
        actionType: 'Report',
        allocatedMinutes: 30,
        proposalStatusBadgeEn: 'Information Report — Student Health Services',
        proposalStatusBadgeEs: 'Informe Informativo — Servicios de Salud Estudiantil',
        whatIsProposedEn:
          'Director of Health and Wellness Patrinia Redd and District Lead Nurse Phoebe Reid-Chambers present 2025-26 and fall 2026-27 metrics on vision/hearing/dental screenings, chronic health condition care plans, staff CPR/First Aid certification, and middle-school e-bike safety initiatives.',
        whatIsProposedEs:
          'La Directora de Salud y Bienestar, Patrinia Redd, y la Enfermera Principal del Distrito, Phoebe Reid-Chambers, presentan indicadores de evaluaciones de vista, audición y salud dental, planes de atención médica, certificación en RCP y seguridad en bicicletas eléctricas (e-bikes).',
        whyItMattersEn:
          'Directly connects physical health screenings and school nursing capacity to chronic absenteeism reduction (LCAP Goal 1) across all 12 school sites.',
        whyItMattersEs:
          'Conecta directamente las evaluaciones preventivas de salud y la enfermería escolar con la reducción del ausentismo crónico (Meta 1 del LCAP) en las 12 escuelas.',
        citations: [
          {
            labelEn: 'Health and Wellness Department Update Deck (10/14/26)',
            labelEs: 'Presentación del Departamento de Salud y Bienestar (14/10/26)',
            filename: 'Health-and-Wellness-Board-Presentation-10.14.26.pdf',
            pageRange: 'pp. 1–16',
            extractionStatus: 'text-extracted',
          },
        ],
      },
      {
        itemLabel: '12.1',
        titleEn: 'Approval of Personnel Changes & New Director of Fiscal Services Job Description',
        titleEs: 'Aprobación de Cambios de Personal y Nueva Descripción de Puesto para Director(a) de Servicios Fiscales',
        actionType: 'Action',
        allocatedMinutes: 5,
        proposalStatusBadgeEn: 'Action Item — Approved by Voice Vote',
        proposalStatusBadgeEs: 'Punto de Acción — Aprobado por Voto de Voz',
        whatIsProposedEn:
          'Approves routine personnel changes alongside a new classified-management job description for Director of Fiscal Services reporting to the Chief Business Official (CBO), responsible for the district budget, First/Second Interim reports, year-end Unaudited Actuals, annual audit, and supervising two accounting managers.',
        whatIsProposedEs:
          'Aprueba cambios de personal junto con una nueva descripción de puesto gerencial clasificado para Director(a) de Servicios Fiscales bajo la supervisión del Director de Finanzas (CBO), a cargo del presupuesto, informes interinos, cierre anual y supervisión de dos gerentes de contabilidad.',
        whyItMattersEn:
          'Strengthens Business Services leadership capacity as the district manages multi-year budget alignment and upcoming labor settlement integrations.',
        whyItMattersEs:
          'Refuerza la capacidad técnica del área de Finanzas mientras el distrito gestiona el ajuste presupuestario plurianual y la integración de acuerdos laborales.',
        citations: [
          {
            labelEn: 'Director of Fiscal Services Job Description (Item 12.1)',
            labelEs: 'Descripción del Puesto de Director(a) de Servicios Fiscales (Punto 12.1)',
            filename: 'Director-of-Fiscal-Services-Job-Description.pdf',
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
          fundingSourceEn: 'Measure S Bond (Fund 21)',
          fundingSourceEs: 'Bono Medida S (Fondo 21)',
          flags: ['financial-threshold', 'contract-amendment-or-change-order'],
          summaryEn:
            'Adds $81,760.42 and 2 calendar days for baseball backstop demolition, drilled-shaft dewatering, and temporary casing (Teichert subcontract), raising the Holt Renewables contract from $2,282,128.00 originally ($2,291,592.62 after CO #1–2) to $2,373,353.04.',
          summaryEs:
            'Agrega $81,760.42 y 2 días calendario por demolición de malla trasera, drenaje de perforaciones y revestimiento temporal (subcontrato Teichert), elevando el contrato con Holt Renewables de $2,282,128.00 originales a $2,373,353.04.',
          citations: [
            {
              labelEn: 'MIT Solar Phase 2 Change Order #3 (Holt Renewables)',
              labelEs: 'Orden de Cambio N.º 3 — Proyecto Solar MIT Fase 2',
              filename: 'MIT-Solar-Project-Phase-2-CO-3.pdf',
              extractionStatus: 'text-extracted',
            },
          ],
        },
        {
          itemLabel: '11.9',
          titleEn: 'Marin COE / CCEE Community Engagement Initiative Peer Leading and Learning Network MOU',
          titleEs: 'Acuerdo (MOU) de la Iniciativa de Participación Comunitaria con Marin COE / CCEE',
          amountDisplay: '+$70,000.00 incoming grant revenue to RCSD',
          fundingSourceEn: 'California Collaborative for Educational Excellence (CCEE) Revenue Grant',
          fundingSourceEs: 'Ingresos por Subvención de CCEE para el Distrito',
          flags: ['financial-threshold'],
          summaryEn:
            'State CCEE grant paying RCSD up to $70,000 for 2026-27 participation in Cohort VI and/or VII of the Community Engagement Initiative (net revenue to RCSD, not an expenditure).',
          summaryEs:
            'Subvención estatal de CCEE que aporta a RCSD hasta $70,000 por participar durante 2026-27 en las Cohortes VI y/o VII de la Iniciativa de Participación Comunitaria (ingreso para el distrito, no un gasto).',
          citations: [
            {
              labelEn: 'Marin COE / CCEE Community Engagement Initiative MOU',
              labelEs: 'MOU de Participación Comunitaria con Marin COE / CCEE',
              filename: 'Marin-COE-CCEE-MOU-2026-27.pdf',
              extractionStatus: 'text-extracted',
            },
          ],
        },
        {
          itemLabel: '11.11',
          titleEn: 'September 1–30, 2026 Warrant Register',
          titleEs: 'Registro de Órdenes de Pago (Warrants) del 1 al 30 de septiembre de 2026',
          amountDisplay: 'Monthly District Vendor Payments',
          fundingSourceEn: 'All District Funds (Indexed in Vendor & Warrant Explorer)',
          fundingSourceEs: 'Todos los Fondos del Distrito (Indexado en el Explorador de Pagos)',
          flags: ['financial-threshold'],
          summaryEn:
            'Monthly statutory ratification of commercial warrants issued across all funds during September 2026.',
          summaryEs:
            'Ratificación mensual de los pagos comerciales emitidos en todos los fondos durante septiembre de 2026.',
          citations: [
            {
              labelEn: 'Warrant Register — September 2026',
              labelEs: 'Registro de Pagos — Septiembre 2026',
              filename: 'Warrants-September-2026.pdf',
              extractionStatus: 'text-extracted',
            },
          ],
        },
      ],
      routineSummaryEn:
        'The remaining 10 consent items cover: Measure T bond tracking list for two Scapes Landscape mow-strip projects at Garfield and Kennedy totaling $8,514 (6.2), draft September 30 minutes (11.1), four school field trips for Roosevelt, Hoover, Kennedy, and Garfield (11.2–11.5), After School Music Academy agreement (11.6), BMR Health Services speech-language pathologist at $130/hr (11.7), SMCOE PBIS training MOU (11.8), and LunchAssist child-nutrition compliance software (11.10).',
      routineSummaryEs:
        'Los 10 puntos de consentimiento restantes cubren: lista de proyectos menores a $20k de la Medida T por $8,514 en Garfield y Kennedy (6.2), borrador de actas del 30 de septiembre (11.1), cuatro excursiones escolares de Roosevelt, Hoover, Kennedy y Garfield (11.2–11.5), contrato con After School Music Academy (11.6), terapeuta del habla de BMR Health Services a $130/hora (11.7), MOU de capacitación PBIS con SMCOE (11.8) y software de nutrición escolar LunchAssist (11.10).',
      extractionNotes: [],
    },
  },

  '2026-09-30': {
    date: '2026-09-30',
    meetingSlug: '2026-09-30-special',
    meetingStage: 'completed',
    qualityState: 'human-reviewed',
    overviewEn:
      'Single-topic 6:00 PM Study Session dedicated to K–5 Formative Assessments (Professional Learning Communities, i-Ready Reading & Math diagnostics, and UCSF Multitudes universal dyslexia/literacy screening). Trustees spent over two hours examining school-by-school reading and math growth and debating how to measure student growth fairly across proficiency tiers.',
    overviewEs:
      'Sesión de Estudio única a las 6:00 p. m. dedicada a las Evaluaciones Formativas de K–5 (Comunidades de Aprendizaje Profesional, diagnósticos i-Ready de Lectura y Matemáticas, y evaluación universal de lectoescritura/dislexia Multitudes de UCSF). Los miembros de la Junta dedicaron más de dos horas a analizar el crecimiento en lectura y matemáticas y cómo medir el progreso estudiantil.',
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
          'Educational Services presents how K–5 teacher teams use Professional Learning Communities (PLCs), i-Ready Reading and Math diagnostic windows, and the state-mandated Multitudes early literacy screener. The slide deck reports district-wide i-Ready Reading growth rising from 54% (Spring 2024) → 57% (Spring 2025) → 60.7% (Winter 2025-26) against a 66% LCAP goal, and Math growth rising from 46% → 47% → 56.4% against a 58% goal. It also shows preliminary 2025-26 CAASPP scores as of June 5, 2026 ("99% release" ELA: 50.6% met/exceeded; "97% release" Math: 43.7% met/exceeded; English Learners: 8.1% ELA and 2.6% Math vs. LCAP targets of 20% and 16%).',
        whatIsProposedEs:
          'Servicios Educativos presenta cómo los equipos docentes de K–5 utilizan las Comunidades de Aprendizaje Profesional (PLC), los diagnósticos i-Ready de Lectura y Matemáticas y el evaluador temprano de lectoescritura Multitudes. La presentación reporta un crecimiento en Lectura i-Ready de 54% (primavera 2024) → 57% (primavera 2025) → 60.7% (invierno 2025-26) frente a la meta del 66%, y en Matemáticas de 46% → 47% → 56.4% frente a la meta del 58%. También incluye resultados preliminares de CAASPP 2025-26 al 5 de junio de 2026 (50.6% en ELA y 43.7% en Matemáticas; Aprendices de Inglés: 8.1% en ELA y 2.6% en Matemáticas frente a metas del 20% y 16%).',
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
            'Spring 2024 & Spring 2025 compared to Winter 2025-26; CAASPP figures are pre-certification district pulls, not final CDE DataQuest releases.',
          priorBaselineNoteEs:
            'Primavera 2024 y Primavera 2025 comparadas con Invierno 2025-26; las cifras CAASPP son reportes preliminares previos a la certificación oficial del CDE.',
        },
        citations: [
          {
            labelEn: 'Ed. Services Board Report: PLCs, Formative Assessment, i-Ready & Multitudes',
            labelEs: 'Informe de Servicios Educativos: PLC, Evaluación Formativa, i-Ready y Multitudes',
            filename: 'Ed.-Services-Board-Report-PLCs-Formative-Assessment-9.30.26.pdf',
            pageRange: 'pp. 1–28',
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
        itemLabel: '9.1',
        titleEn: '2026–27 Annual Enrollment and Capacity Review & Next Steps for Facility and Program Planning',
        titleEs: 'Revisión Anual de Matrícula y Capacidad 2026–27 y Próximos Pasos para la Planificación de Instalaciones y Programas',
        actionType: 'Action',
        allocatedMinutes: 45,
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
            'Day-10 count (6,199) precedes the OctoberPreliminary Census Day count (6,399 reported on 10/28). Capacity (12,362) is gross facility capacity across 12 operating school sites.',
          priorBaselineNoteEs:
            'El conteo al Día 10 (6,199) precede al conteo preliminar del Día del Censo de octubre (6,399 reportado el 28/10). La capacidad (12,362) corresponde a la capacidad bruta en los 12 planteles.',
        },
        citations: [
          {
            labelEn: '2026-27 Annual Enrollment & Capacity Review Deck (Updated 9/23/26)',
            labelEs: 'Presentación de Matrícula y Capacidad 2026-27 (Actualizada 23/09/26)',
            filename: '2026-27-Enrollment-Capacity-Review-26.09.23.-updated.pdf',
            pageRange: 'pp. 1–32',
            extractionStatus: 'text-extracted',
          },
        ],
      },
      {
        itemLabel: '9.4 & 9.5',
        titleEn: '2025-26 Unaudited Actuals Financial Report & Resolution No. 10 (Gann Appropriations Limit)',
        titleEs: 'Informe Financiero de Resultados No Auditados 2025-26 y Resolución N.º 10 (Límite de Apropiaciones Gann)',
        actionType: 'Action',
        allocatedMinutes: 35,
        proposalStatusBadgeEn: 'Action Items — Unaudited Actuals Approved 5–0; Gann Limit Approved 4–0',
        proposalStatusBadgeEs: 'Puntos de Acción — Cierre No Auditado Aprobado 5–0; Límite Gann Aprobado 4–0',
        whatIsProposedEn:
          'Closes the 2025-26 fiscal year books prior to independent audit. The General Fund recorded $147.48M in operating revenues and $157.22M in expenditures—an operating deficit of $9.73M—offset by an $11.0M interfund transfer ("Transfers - RDA Negotiated Agreements", bringing total credited revenue to $158.48M). Ending General Fund balance rose $1.27M to $18.38M ($5.63M above Estimated Actuals because expenditures came in $9.54M under projection), leaving an ~4.0% reserve against the 3.0% state minimum. Resolution 10 sets the 2025-26 Gann Limit at $94,351,626.61 and projects $97,021,787.08 for 2026-27.',
        whatIsProposedEs:
          'Cierra los libros del año fiscal 2025-26 antes de la auditoría independiente. El Fondo General registró $147.48M en ingresos operativos y $157.22M en gastos —un déficit operativo de $9.73M— compensado por una transferencia interbancaria de $11.0M ("Acuerdos Negociados RDA", llevando el ingreso total contabilizado a $158.48M). El saldo final subió $1.27M hasta $18.38M ($5.63M mejor que lo estimado porque el gasto fue $9.54M menor a lo proyectado), dejando una reserva de ~4.0% frente al mínimo estatal del 3.0%. La Resolución 10 fija el Límite Gann 2025-26 en $94,351,626.61.',
        whyItMattersEn:
          'Distinguishing the $9.73M structural operating deficit from the $1.27M net fund-balance gain (driven by a one-time $11.0M capital/RDA transfer and $9.54M in unspent budget) is essential for understanding why RCSD still faces multi-year budget reductions.',
        whyItMattersEs:
          'Distinguir el déficit operativo estructural de $9.73M del aumento neto de $1.27M en el saldo final (impulsado por una transferencia única de $11.0M de fondos RDA y subejercicio presupuestario) es clave para entender el reto fiscal plurianual del distrito.',
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
            pageRange: 'pp. 1–140',
            extractionStatus: 'text-extracted',
          },
          {
            labelEn: '2025-26 Unaudited Actuals Board Presentation',
            labelEs: 'Presentación de Resultados No Auditados 2025-26',
            filename: '25-26-UA-Presentation.pdf',
            pageRange: 'pp. 1–18',
            extractionStatus: 'text-extracted',
          },
        ],
      },
      {
        itemLabel: '6.1 & 11.1–11.3',
        titleEn: 'MTSS Attendance/Suspension Report (LCAP Goal 1) & Charter School Fiscal Oversight Letters (Connect, KIPP, Rocketship)',
        titleEs: 'Informe MTSS de Asistencia y Suspensiones (Meta 1 del LCAP) y Cartas de Supervisión Fiscal de Escuelas Chárter',
        actionType: 'Report / Information',
        allocatedMinutes: 30,
        proposalStatusBadgeEn: 'Oversight & LCAP Monitoring Reports',
        proposalStatusBadgeEs: 'Informes de Supervisión Chárter y Monitoreo LCAP',
        whatIsProposedEn:
          'Item 6.1 reports chronic absenteeism as of September 9, 2026 at 9.11% (578 of 6,307 students; highest at McKinley 15%, lowest at Orion 4%). Information Items 11.1–11.3 publish RCSD’s fiscal oversight review letters on the 2026-27 Adopted Budgets and LCAPs of Connect, KIPP Excelencia, and Rocketship: Rocketship is below the 5% MOU reserve minimum in 2025-26 (4.48%) and 2026-27 (4.79%); Connect projects deficits across all three years with reserves dropping from 17% to 3.69% by 2028-29; and all three charters had mismatches between their LCAP Budget Overview for Parents and Adopted Budget.',
        whatIsProposedEs:
          'El Punto 6.1 reporta un ausentismo crónico al 9 de septiembre de 2026 del 9.11% (578 de 6,307 estudiantes; el más alto en McKinley con 15% y el más bajo en Orion con 4%). Los Puntos 11.1–11.3 publican las cartas de supervisión fiscal de RCSD sobre Connect, KIPP Excelencia y Rocketship: Rocketship está por debajo de la reserva mínima del 5% del MOU en 2025-26 (4.48%) y 2026-27 (4.79%); Connect proyecta déficits en los tres años cayendo al 3.69% en 2028-29; y las tres escuelas chárter presentaron discrepancias entre el resumen presupuestario del LCAP para padres y su presupuesto adoptado.',
        whyItMattersEn:
          'Surfaces early warning indicators on charter reserve compliance ahead of the 2026-27 charter oversight and renewal cycle.',
        whyItMattersEs:
          'Destaca alertas tempranas sobre el cumplimiento de reservas financieras en las escuelas chárter autorizadas por el distrito.',
        citations: [
          {
            labelEn: 'Rocketship FY 2026-27 Adopted Budget Oversight Review Letter',
            labelEs: 'Carta de Supervisión Fiscal 2026-27 — Rocketship',
            filename: 'Rocketship-FY-2026-27-Adopted-Budget-Review-Letter.pdf',
            pageRange: 'pp. 1–4',
            extractionStatus: 'text-extracted',
          },
          {
            labelEn: 'Connect FY 2026-27 Adopted Budget Oversight Review Letter',
            labelEs: 'Carta de Supervisión Fiscal 2026-27 — Connect',
            filename: 'Connect-FY-2026-27-Adopted-Budget-Review-Letter.pdf',
            pageRange: 'pp. 1–4',
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
          fundingSourceEn: 'Restricted Categorical / Literacy Funds',
          fundingSourceEs: 'Fondos Categóricos Restringidos de Lectoescritura',
          flags: ['financial-threshold'],
          summaryEn:
            'Contracts with Air Education Inc. for high-dosage virtual reading tutoring during the 2026-27 school year.',
          summaryEs:
            'Contrata a Air Education Inc. para tutoría virtual intensiva de lectura durante el ciclo escolar 2026-27.',
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
            'Keeps Kennedy’s total 2026-27 Measure U allocation at $195,228 but strikes the $85,000 STEAM teacher line and reallocates the funds to a dedicated guest teacher ($40,000), community school coordinator ($25,000), Caminar mental health counseling ($17,030), and PBIS ($2,489).',
          summaryEs:
            'Mantiene la asignación total de la Medida U de Kennedy en $195,228, pero elimina la partida de $85,000 para maestro STEAM y reasigna los fondos a un maestro suplente dedicado ($40,000), coordinador de escuela comunitaria ($25,000), consejería de Caminar ($17,030) y PBIS ($2,489).',
          citations: [
            {
              labelEn: 'Kennedy Middle School Measure U Addendum 1 (Memo & Plan)',
              labelEs: 'Adenda 1 Medida U — Kennedy Middle School',
              url: 'https://simbli.eboardsolutions.com/SB_Meetings/ViewMeeting.aspx?S=36030397&MID=51864',
              extractionStatus: 'text-extracted',
            },
          ],
        },
        {
          itemLabel: '8.8',
          titleEn: 'Amergis Healthcare Staffing First Amendment (Special Education Behavior Technicians)',
          titleEs: 'Primera Enmienda con Amergis Healthcare Staffing (Técnicos de Conducta para Educación Especial)',
          amountDisplay: '+$142,920.00 (New contract total: $294,920.00)',
          fundingSourceEn: 'Special Education (Restricted General Fund)',
          fundingSourceEs: 'Educación Especial (Fondo General Restringido)',
          flags: ['financial-threshold', 'contract-amendment-or-change-order'],
          summaryEn:
            'Adds two Special Education behavior technicians (+$142,920) to the 2026-27 Amergis staffing agreement, bringing the total contract ceiling from $152,000 to $294,920.',
          summaryEs:
            'Agrega dos técnicos de conducta de Educación Especial (+$142,920) al acuerdo 2026-27 con Amergis, elevando el monto total del contrato de $152,000 a $294,920.',
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
          fundingSourceEn: 'Routine Restricted Maintenance (RRM)',
          fundingSourceEs: 'Mantenimiento Restringido de Rutina (RRM)',
          flags: ['financial-threshold'],
          summaryEn:
            'Annual fire alarm and life-safety inspection and testing across district facilities for 2026-27.',
          summaryEs:
            'Inspección y pruebas anuales de alarmas contra incendios y seguridad vital en las instalaciones del distrito para 2026-27.',
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
          itemLabel: '8.12–8.16',
          titleEn: 'Board Bylaws 9250 (Trustee Remuneration Fixed at $1,200/mo) & 9320 (Meetings and Notices) + Policies 4140/4240/4340 (Bargaining Units)',
          titleEs: 'Estatutos de la Junta 9250 (Remuneración Fijada en $1,200/mes) y 9320 (Reuniones y Avisos) + Políticas 4140/4240/4340 (Unidades Sindicales)',
          amountDisplay: 'Governance & Trustee Compensation Bylaw Update',
          fundingSourceEn: 'General Fund (Board Bylaw 9250)',
          fundingSourceEs: 'Fondo General (Estatuto 9250)',
          flags: ['policy-or-bylaw-revision'],
          summaryEn:
            'Revises Board Bylaw 9250 to replace "may receive the maximum monthly compensation" under Ed Code 35120 with a fixed $1,200/month stipend (noting trustees may decline it), updates BB 9320 (Meetings and Notices), and updates BP 4140/4240/4340 (Bargaining Units).',
          summaryEs:
            'Modifica el Estatuto 9250 de la Junta para reemplazar "el máximo permitido" bajo el Código de Educación 35120 por un estipendio fijo de $1,200 al mes (aclarando que los miembros pueden optar por no recibirlo), actualiza el Estatuto 9320 (Reuniones y Avisos) y las Políticas 4140/4240/4340 (Unidades de Negociación).',
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
        'The remaining 7 consent items cover: draft September 9 minutes (8.1), three Outdoor Education field trips for Clifford, Orion, and North Star (8.3–8.5), the 2026–2029 Stanford Teacher Education Program (STEP) student-teacher placement agreement (8.6), a 36-month Sourcewell agreement with Motive Technologies for fleet cameras and telematics across 16 school buses (8.9), and the UniFirst uniform rental renewal (8.11).',
      routineSummaryEs:
        'Los 7 puntos de consentimiento restantes cubren: el borrador de actas del 9 de septiembre (8.1), tres excursiones de Educación al Aire Libre para Clifford, Orion y North Star (8.3–8.5), el convenio 2026–2029 con la Universidad de Stanford (STEP) para prácticas docentes (8.6), un contrato de 36 meses con Motive Technologies para cámaras y telemática en 16 autobuses escolares (8.9) y la renovación de alquiler de uniformes con UniFirst (8.11).',
      extractionNotes: [
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
      generatedAt: '2026-10-29T20:45:00Z',
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
      routineSummaryEn: base.consentScreening.routineSummaryEn,
      routineSummaryEs: base.consentScreening.routineSummaryEs,
      extractionNotes: base.consentScreening.extractionNotes || [],
    },
  };

  const validation = validateDocketBrief(doc);
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
      generatedAt: '2026-10-29T20:45:00Z',
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
      checkedAt: '2026-10-29T20:45:00Z',
      exceptions: [
        {
          code: 'scanned-pdf-memo-fallback',
          message:
            'On 2026-10-28, Item 6.1 DSA/PG&E fee receipts and Item 10.4 KIPP Measure U application are image scans; dollar figures ($69,089.12 and $156,326.00) are verified from the structured Simbli memo.',
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
