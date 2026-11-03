#!/usr/bin/env node
/**
 * Generate and validate bilingual (EN/ES), evidence-typed Post-Meeting Deliberation
 * Recaps (`data/deliberation-recaps/{date}.json` + `data/deliberation-recaps/index.json`).
 *
 * Every item separates four distinct evidentiary layers:
 *   1. `proposal`           — What the pre-meeting board packet proposed (PDF citation)
 *   2. `discussion`         — What staff, public commenters, and trustees stated on video
 *                             (with clickable [MM:SS] timestamps and interval-verified
 *                             speaker attribution; global diarization maps are never trusted)
 *   3. `motion_recorded`    — What motion/roll-call vote was heard on video (badged as
 *                             provisional until formal minutes are approved)
 *   4. `minutes_reconciled` — What the formally approved minutes record (or pending state)
 */

import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  formatTimestamp,
  validateDeliberationRecap,
} from './lib/deliberation-recap.mjs';
import { enrichCitationArtifacts, R2_BASE } from './lib/docket-brief.mjs';
import { hashFile, validateDatasetProvenance } from './lib/provenance.mjs';
import { validateJsonSchema } from './lib/provenance-schema.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = resolve(__dirname, '..');

const meetingsData = JSON.parse(readFileSync(resolve(ROOT, 'data/meetings-data.json'), 'utf-8'));

function getMeetingByDate(date) {
  return meetingsData.meetings.find((m) => m.date === date) || null;
}

const REVIEWED_RECAPS = {
  '2026-10-14': {
    date: '2026-10-14',
    meetingSlug: '2026-10-14-regular',
    videoId: '6eRAjFYrWOk',
    overviewEn:
      'The Board moved Item 9.1 (Health and Wellness Department update) ahead of the KIPP Excelencia Public Hearing at the start of the meeting. Nine community members—teachers, students, parents, and operations staff—spoke in support of KIPP Excelencia’s 2027–2032 charter renewal petition, followed by Trustee questioning on KIPP’s five-year deficit projections and its 799-student charter cap. Bond Consent (including the $81,760.42 MIT Solar Phase 2 Change Order #3), General Consent, and Personnel Actions (including the new Director of Fiscal Services job description) were approved by voice vote.',
    overviewEs:
      'Al inicio de la sesión, la Junta adelantó el Punto 9.1 (actualización del Departamento de Salud y Bienestar) antes de la Audiencia Pública de KIPP Excelencia. Nueve miembros de la comunidad —maestros, estudiantes, padres y personal operativo— hablaron a favor de la renovación chárter 2027–2032 de KIPP Excelencia, seguidos por preguntas de la Junta sobre las proyecciones deficitarias de cinco años de KIPP y su tope de matrícula de 799 estudiantes. El Consentimiento del Bono (incluida la Orden de Cambio N.º 3 del proyecto solar en MIT por $81,760.42), el Consentimiento General y los puntos de Personal se aprobaron por voto de voz.',
    agendaReorderNoteEn:
      'At [3:47], President Weekly proposed moving Item 9.1 (Health and Wellness Department Update) immediately after Section 6 (Bond Program Consent Items) at staff’s request; approved by voice vote at [4:29].',
    agendaReorderNoteEs:
      'En el minuto [3:47], el Presidente Weekly propuso adelantar el Punto 9.1 (Actualización de Salud y Bienestar) inmediatamente después de la Sección 6 (Consentimiento del Bono) a solicitud del personal; aprobado por voto de voz en [4:29].',
    corrections: [],
    items: [
      {
        itemLabel: '8.1',
        titleEn: 'Public Hearing: KIPP Excelencia Charter Renewal Petition (2027–2032)',
        titleEs: 'Audiencia Pública: Petición de Renovación Chárter de KIPP Excelencia (2027–2032)',
        proposal: {
          textEn:
            'Initial statutory public hearing under Education Code § 47605(b) on KIPP Excelencia Community Prep’s petition for a five-year charter renewal (July 1, 2027 – June 30, 2032) in the state’s "middle performing" tier. The 90-day statutory deadline for a Board grant-or-deny decision is December 20, 2026.',
          textEs:
            'Audiencia pública inicial bajo el Código de Educación § 47605(b) sobre la petición de KIPP Excelencia Community Prep para renovar su estatuto chárter por cinco años (1 de julio de 2027 – 30 de junio de 2032) en la categoría estatal de desempeño medio. El plazo legal de 90 días para que la Junta tome una decisión vence el 20 de diciembre de 2026.',
          citations: [
            {
              labelEn: 'KIPP Excelencia Charter Renewal Petition 2027–2032',
              labelEs: 'Petición de Renovación Chárter KIPP Excelencia 2027–2032',
              filename: 'KIPP-Excelencia-Charter-Renewal-Petition-2027-2032.pdf',
              extractionStatus: 'text-extracted',
            },
            {
              labelEn: 'KIPP Public Hearing Presentation Deck (10/14/26)',
              labelEs: 'Presentación de Audiencia Pública de KIPP (14/10/26)',
              filename: 'KIPP-Excelencia-Public-Hearing-Presentation-10.14.26.pdf',
              extractionStatus: 'text-extracted',
            },
          ],
        },
        discussion: {
          summaryEn:
            'Following KIPP’s presentation ([38:18]) and nine public speakers supporting renewal ([47:28]–[65:54]), President Weekly questioned KIPP leadership and regional finance staff on why the five-year budget in the petition projects annual operating deficits drawing reserves down from ~$3.7M to ~$1.8M, and how a projected rise from 704 to 799 students fits regional demographic decline and the Fair Oaks campus.',
          summaryEs:
            'Tras la presentación de KIPP ([38:18]) y nueve oradores públicos a favor de la renovación ([47:28]–[65:54]), el Presidente Weekly preguntó a los directivos y al equipo financiero de KIPP por qué el presupuesto de cinco años en la petición proyecta déficits anuales que reducen las reservas de ~$3.7M a ~$1.8M, y cómo se explica una proyección de 704 a 799 estudiantes frente a la baja demográfica regional.',
          highlights: [
            {
              speakerLabelEn: '9 KIPP Community Speakers (Teachers, Students, Parents & Staff)',
              speakerLabelEs: '9 Oradores de la Comunidad de KIPP (Maestros, Estudiantes, Padres y Personal)',
              attributionScope: 'interval-verified',
              startSeconds: 2848,
              endSeconds: 3954,
              textEn:
                'Nine speakers—including 2nd-grade teacher Sawyer Dean, 6th-grade science teacher Lindsay Parmet, students Julian Martinez, Andrea Torres Ruiz, and Julian Navarro, parents Carla Carranza and Alma Valdez (via Spanish interpreter), and operations leaders Cynthia Morphin and Anna Jones—urged the Board to renew the charter, highlighting IEP support, bilingual family partnerships, and music/science instruction.',
              textEs:
                'Nueve oradores —incluidos los docentes Sawyer Dean y Lindsay Parmet, los estudiantes Julian Martinez, Andrea Torres Ruiz y Julian Navarro, las madres Carla Carranza y Alma Valdez (con interpretación en español) y el personal operativo— pidieron a la Junta renovar el chárter, destacando el apoyo en IEP, la comunicación bilingüe y las clases de música y ciencias.',
            },
            {
              speakerLabelEn: 'President David Weekly & KIPP Regional Finance Staff (Kenzie)',
              speakerLabelEs: 'Presidente David Weekly y Personal Financiero Regional de KIPP (Kenzie)',
              attributionScope: 'interval-verified',
              startSeconds: 3978,
              endSeconds: 4054,
              textEn:
                'President Weekly asked why the petition’s five-year budget shows a deficit every year with reserves dropping from ~$3.7M to ~$1.8M. KIPP finance representative Kenzie explained that KIPP builds conservative multi-year petition projections jointly with its regional finance office and adjusts annual operational budgets each spring based on actual enrollment.',
              textEs:
                'El Presidente Weekly preguntó por qué el presupuesto a cinco años muestra déficits anuales con reservas bajando de ~$3.7M a ~$1.8M. La representante financiera de KIPP (Kenzie) explicó que la organización elabora proyecciones plurianuales conservadoras con su oficina regional y ajusta el presupuesto operativo cada año según la matrícula real.',
            },
            {
              speakerLabelEn: 'President David Weekly, KIPP Leadership & Regional Finance Staff',
              speakerLabelEs: 'Presidente David Weekly, Dirección de KIPP y Personal Financiero Regional',
              attributionScope: 'interval-verified',
              startSeconds: 4055,
              endSeconds: 4164,
              textEn:
                'When asked how KIPP projects growing from 704 to 799 students (and Kindergarten from 55 to 84) amid countywide enrollment decline, KIPP staff clarified that 799 is ~150 students lower than its prior charter cap (~940) and represents an upper facility ceiling rather than a guaranteed annual budget target, driven partly by Transitional Kindergarten (TK) expansion.',
              textEs:
                'Ante la pregunta sobre cómo proyectan crecer de 704 a 799 alumnos en medio de una baja demográfica regional, el equipo de KIPP aclaró que 799 reduce en ~150 alumnos el tope de su petición anterior (~940) y funciona como un techo máximo de capacidad más que como una meta presupuestaria anual fija, apoyado en la expansión de TK.',
            },
          ],
        },
        motion_recorded: {
          status: 'public-hearing-no-vote',
          voteType: 'none',
          tally: null,
          startSeconds: 4200,
          textEn:
            'Public hearing closed with no vote taken (statutory public hearing only; the Board must vote to grant or deny the renewal petition by December 20, 2026 unless extended by 30 days by mutual agreement).',
          textEs:
            'Se cerró la audiencia pública sin votación (audiencia legal únicamente; la Junta debe votar para aprobar o denegar la renovación a más tardar el 20 de diciembre de 2026, salvo prórroga mutua de 30 días).',
        },
        minutes_reconciled: {
          status: 'pending-approval',
          approvedAtDate: null,
          minutesUrl: null,
          textEn:
            'Formal minutes for the October 14, 2026 meeting have not yet been approved by the Board.',
          textEs:
            'Las actas oficiales de la reunión del 14 de octubre de 2026 aún no han sido aprobadas por la Junta.',
        },
      },
      {
        itemLabel: '9.1',
        titleEn: 'Update on the Redwood City School District Health and Wellness Department',
        titleEs: 'Actualización sobre el Departamento de Salud y Bienestar de RCSD',
        proposal: {
          textEn:
            'Information report on RCSD student health screenings (vision, hearing, dental), nursing care plans, staff CPR certification, and e-bike safety partnerships.',
          textEs:
            'Informe sobre evaluaciones preventivas de salud estudiantil (vista, audición, dental), planes de enfermería, certificación en RCP y seguridad en bicicletas eléctricas.',
          citations: [
            {
              labelEn: 'Health and Wellness Department Presentation (10/14/26)',
              labelEs: 'Presentación del Departamento de Salud y Bienestar (14/10/26)',
              filename: 'Health-and-Wellness-Board-Presentation-10.14.26.pdf',
              extractionStatus: 'text-extracted',
            },
          ],
        },
        discussion: {
          summaryEn:
            'Director Patrinia Redd, District Lead Nurse Phoebe Reid-Chambers, and student presenters shared health screening data. Trustees praised student participation and asked how the district follows up when students lose or break prescription glasses or lack vision insurance.',
          summaryEs:
            'La Directora Patrinia Redd, la Enfermera Principal Phoebe Reid-Chambers y estudiantes invitados presentaron datos sobre evaluaciones de salud. Los miembros de la Junta agradecieron la participación estudiantil y preguntaron cómo se da seguimiento cuando un estudiante pierde o rompe sus lentes o no tiene seguro médico.',
          highlights: [
            {
              speakerLabelEn: 'Vice President Cecilia I. Márquez, President David Weekly & Health Staff',
              speakerLabelEs: 'Vicepresidenta Cecilia I. Márquez, Presidente David Weekly y Personal de Salud',
              attributionScope: 'interval-verified',
              startSeconds: 1430,
              endSeconds: 1545,
              textEn:
                'Vice President Márquez and President Weekly asked how staff track students who need replacement eyeglasses or lack insurance. Staff explained that Vision to Learn replaces lost or broken glasses once within a year, teachers email District Lead Nurse Phoebe Reid-Chambers directly when glasses break at school, and the district partners with the Lions Club for uninsured families.',
              textEs:
                'La Vicepresidenta Márquez y el Presidente Weekly preguntaron cómo se apoya a los estudiantes que pierden sus lentes o no tienen seguro. El personal explicó que Vision to Learn reemplaza lentes rotos o extraviados una vez durante el primer año, los maestros avisan directamente a la enfermera principal Phoebe Reid-Chambers y el distrito colabora con el Club de Leones para familias sin seguro.',
            },
          ],
        },
        motion_recorded: {
          status: 'no-vote-information-only',
          voteType: 'none',
          tally: null,
          startSeconds: 2260,
          textEn: 'Information report only; no Board vote required.',
          textEs: 'Informe informativo únicamente; no requiere votación de la Junta.',
        },
        minutes_reconciled: {
          status: 'pending-approval',
          approvedAtDate: null,
          minutesUrl: null,
          textEn: 'Pending formal minutes approval.',
          textEs: 'Pendiente de aprobación de las actas oficiales.',
        },
      },
      {
        itemLabel: '6, 11 & 12.1–12.2',
        titleEn: 'Bond Consent ($81.8K MIT Solar CO #3), General Consent & Personnel Actions (Director of Fiscal Services)',
        titleEs: 'Consentimiento del Bono (Orden de Cambio Solar en MIT por $81.8K), Consentimiento General y Acciones de Personal',
        proposal: {
          textEn:
            'Approves Bond Consent Items 6.1–6.2 (including $81,760.42 Change Order #3 for MIT Solar Phase 2), General Consent Items 11.1–11.11 (including September 30 minutes, $70,000 Marin COE/CCEE grant MOU, and September warrants), Item 12.1 (Personnel Report & Director of Fiscal Services job description), and Item 12.2 (Resolution No. 11 on Education Code teaching assignments).',
          textEs:
            'Aprueba el Consentimiento del Bono 6.1–6.2 (incluida la Orden de Cambio N.º 3 del proyecto solar en MIT por $81,760.42), el Consentimiento General 11.1–11.11 (incluidas las actas del 30 de septiembre, la subvención CCEE de $70,000 y los pagos de septiembre), el Punto 12.1 (Informe de Personal y puesto de Director de Servicios Fiscales) y el Punto 12.2 (Resolución N.º 11).',
          citations: [
            {
              labelEn: 'MIT Solar Phase 2 Change Order #3 (Item 6.1)',
              labelEs: 'Orden de Cambio N.º 3 — Proyecto Solar MIT Fase 2 (Punto 6.1)',
              filename: 'MIT-Solar-Project-Phase-2-CO-3.pdf',
              extractionStatus: 'text-extracted',
            },
            {
              labelEn: 'Director of Fiscal Services Job Description (Item 12.1)',
              labelEs: 'Descripción del Puesto de Director(a) de Servicios Fiscales (Punto 12.1)',
              filename: 'Director-of-Fiscal-Services-Job-Description.pdf',
              extractionStatus: 'text-extracted',
            },
          ],
        },
        discussion: {
          summaryEn:
            'No items were pulled from Bond Consent or General Consent. Both consent calendars and both personnel actions were approved rapidly without debate.',
          summaryEs:
            'Ningún punto fue retirado de los calendarios de consentimiento. Ambos bloques de consentimiento y las dos acciones de personal se aprobaron sin debate.',
          highlights: [
            {
              speakerLabelEn: 'Board of Trustees (Bond Consent Vote)',
              speakerLabelEs: 'Mesa Directiva (Votación de Consentimiento del Bono)',
              attributionScope: 'interval-verified',
              startSeconds: 355,
              endSeconds: 385,
              textEn:
                'Bond Program Consent Calendar (Items 6.1–6.2) moved, seconded, and approved by unanimous voice vote.',
              textEs:
                'El Calendario de Consentimiento del Programa de Bonos (Puntos 6.1–6.2) fue propuesto, secundado y aprobado por unanimidad mediante voto de voz.',
            },
            {
              speakerLabelEn: 'Board of Trustees (General Consent & Personnel Actions)',
              speakerLabelEs: 'Mesa Directiva (Consentimiento General y Acciones de Personal)',
              attributionScope: 'interval-verified',
              startSeconds: 4205,
              endSeconds: 4345,
              textEn:
                'General Consent Calendar (Section 11, vote at [70:51]), Personnel Changes & Director of Fiscal Services Job Description (Item 12.1, vote at [71:49]), and Resolution No. 11 (Item 12.2, vote at [72:23]) were each approved by unanimous voice vote.',
              textEs:
                'El Calendario de Consentimiento General (Sección 11, votación en [70:51]), los Cambios de Personal y puesto de Director de Servicios Fiscales (Punto 12.1, votación en [71:49]) y la Resolución N.º 11 (Punto 12.2, votación en [72:23]) fueron aprobados por unanimidad mediante voto de voz.',
            },
          ],
        },
        motion_recorded: {
          status: 'provisional-video-tally',
          voteType: 'voice vote',
          tally: 'Approved unanimously (voice vote)',
          startSeconds: 4251,
          textEn:
            'Spoken motion and voice votes on video: Section 6 approved at [6:24]; Section 11 approved at [70:51]; Item 12.1 approved at [71:49]; Item 12.2 approved at [72:23]. (Provisional video record until October 14 minutes are formally approved.)',
          textEs:
            'Mociones y votaciones de voz en video: Sección 6 aprobada en [6:24]; Sección 11 aprobada en [70:51]; Punto 12.1 aprobado en [71:49]; Punto 12.2 aprobado en [72:23]. (Registro provisional en video hasta que se aprueben las actas del 14 de octubre.)',
        },
        minutes_reconciled: {
          status: 'pending-approval',
          approvedAtDate: null,
          minutesUrl: null,
          textEn: 'Pending formal minutes approval.',
          textEs: 'Pendiente de aprobación de las actas oficiales.',
        },
      },
    ],
  },

  '2026-09-30': {
    date: '2026-09-30',
    meetingSlug: '2026-09-30-special',
    videoId: 'gRDk94hM0aQ',
    overviewEn:
      'In a 2-hour-19-minute Special Study Session, Assistant Superintendent of Educational Services Anna Herrera and Educational Services staff walked the Board through K–5 formative assessments (PLCs, i-Ready diagnostics and Standards Mastery, BPST foundational decoding, and UCSF Multitudes dyslexia/literacy screening), followed by an extended Board reflection on study-session norms.',
    overviewEs:
      'En una Sesión Especial de Estudio de 2 horas y 19 minutos, la Superintendente Asistente de Servicios Educativos, Anna Herrera, y su equipo presentaron a la Junta las evaluaciones formativas de K–5 (PLC, diagnósticos i-Ready, decodificación BPST y el evaluador de lectoescritura Multitudes de UCSF), seguida de una reflexión sobre la dinámica de las sesiones de estudio.',
    corrections: [],
    items: [
      {
        itemLabel: '6.1',
        titleEn: 'School/Community Reports: Update on Formative Assessments Utilized for K–5',
        titleEs: 'Informes Escolares/Comunitarios: Actualización sobre Evaluaciones Formativas Utilizadas en K–5',
        proposal: {
          textEn:
            'Study session presentation on K–5 formative assessment tools, Professional Learning Communities (PLCs), i-Ready Reading & Math growth metrics, and early literacy screening via UCSF Multitudes.',
          textEs:
            'Presentación en sesión de estudio sobre herramientas de evaluación formativa en K–5, Comunidades de Aprendizaje Profesional (PLC), métricas de crecimiento en i-Ready y detección temprana de lectoescritura con Multitudes de UCSF.',
          citations: [
            {
              labelEn: 'Ed. Services Board Report: PLCs, Formative Assessment, i-Ready & Multitudes',
              labelEs: 'Informe de Servicios Educativos: PLC, Evaluación Formativa, i-Ready y Multitudes',
              filename: 'Ed.-Services-Board-Report-PLCs-Formative-Assessment-9.30.26.pdf',
              extractionStatus: 'text-extracted',
            },
          ],
        },
        discussion: {
          summaryEn:
            'Trustees engaged in an extended Q&A ([38:11]–[130:08]) examining how teachers use assessment data without over-testing students, why foundational phonics decoding (BPST) transitions after 2nd grade, and how Thursday minimum-day PLC collaboration works across small single-track vs. multi-track school sites.',
          summaryEs:
            'Los miembros de la Junta sostuvieron una amplia sesión de preguntas y respuestas ([38:11]–[130:08]) sobre cómo utilizar los datos de evaluación sin sobrecargar a los estudiantes con exámenes, el uso de la evaluación fonética BPST después de 2.º grado y la colaboración docente de los jueves.',
          highlights: [
            {
              speakerLabelEn: 'Trustee Mike Wells, Assistant Superintendent Anna Herrera & Ed. Services Staff',
              speakerLabelEs: 'Miembro de la Junta Mike Wells, Superintendente Asistente Anna Herrera y Equipo Educativo',
              attributionScope: 'interval-verified',
              startSeconds: 2467,
              endSeconds: 2649,
              textEn:
                'Trustee Wells asked how i-Ready diagnostics, unit assessments, and the new state-mandated Multitudes screener fit together without duplicating testing time. Assistant Superintendent Anna Herrera and staff explained that UCSF Multitudes is a free, one-time universal screener required by state law (administered later in the year for Kindergarten) and that i-Ready Standards Mastery modules are optional.',
              textEs:
                'El miembro de la Junta Mike Wells preguntó cómo se complementan i-Ready, las pruebas por unidad y el nuevo evaluador obligatorio Multitudes sin duplicar el tiempo de examen. La Superintendente Asistente Anna Herrera y su equipo explicaron que Multitudes de UCSF es gratuito y se aplica una sola vez por mandato estatal, mientras que los módulos Standards Mastery de i-Ready son opcionales.',
            },
            {
              speakerLabelEn: 'Clerk Jennifer Ng Kwing King & Assistant Superintendent Anna Herrera',
              speakerLabelEs: 'Secretaria Jennifer Ng Kwing King y Superintendente Asistente Anna Herrera',
              attributionScope: 'interval-verified',
              startSeconds: 2871,
              endSeconds: 2950,
              textEn:
                'Clerk Ng Kwing King asked whether grade-level PLC data meetings happen only within each school or across sites, noting that smaller schools have only ~20 students per grade. Assistant Superintendent Herrera explained that staggered bell schedules (e.g., McKinley starting at 8:15 AM vs. Kennedy at 8:30 AM) currently constrain cross-site Thursday PLC blocks.',
              textEs:
                'La Secretaria Ng Kwing King preguntó si las reuniones docentes de PLC se realizan por plantel o entre distintas escuelas, dado que las escuelas pequeñas tienen ~20 alumnos por grado. La Superintendente Asistente Herrera explicó que los horarios escalonados de entrada dificultan por ahora las sesiones conjuntas entre planteles los jueves.',
            },
            {
              speakerLabelEn: 'Trustee Mike Wells, Assistant Superintendent Anna Herrera & Ed. Services Staff',
              speakerLabelEs: 'Miembro de la Junta Mike Wells, Superintendente Asistente Anna Herrera y Equipo Educativo',
              attributionScope: 'interval-verified',
              startSeconds: 2970,
              endSeconds: 3165,
              textEn:
                'Trustee Wells asked why the BPST foundational phonics assessment stops after 2nd grade when some 3rd–5th graders are not yet reading proficiently. Staff clarified that all elementary teachers were trained in CRLP foundational skills and continue using BPST diagnostically for older students who still have decoding gaps.',
              textEs:
                'El miembro de la Junta Wells preguntó por qué la prueba fonética BPST se detiene en 2.º grado cuando algunos alumnos de 3.º a 5.º aún no leen con fluidez. El equipo aclaró que todos los docentes recibieron capacitación CRLP y siguen utilizando el BPST de forma diagnóstica con alumnos mayores que presentan rezagos en decodificación.',
            },
          ],
        },
        motion_recorded: {
          status: 'no-vote-information-only',
          voteType: 'none',
          tally: null,
          startSeconds: 7808,
          textEn: 'Study Session presentation and discussion; no Board vote taken on Item 6.1.',
          textEs: 'Presentación y diálogo en Sesión de Estudio; no hubo votación sobre el Punto 6.1.',
        },
        minutes_reconciled: {
          status: 'reconciled',
          approvedAtDate: '2026-10-14',
          minutesUrl: `${R2_BASE}/board-packets/2026-10-14/2026.09.30-Minutes-DRAFT.pdf`,
          textEn:
            'Minutes of the September 30, 2026 Study Session were approved on the October 14, 2026 Consent Calendar (Item 11.1), recording the presentation and discussion with no action taken.',
          textEs:
            'Las actas de la Sesión de Estudio del 30 de septiembre de 2026 fueron aprobadas en el Calendario de Consentimiento del 14 de octubre de 2026 (Punto 11.1), registrando la presentación sin toma de acuerdos.',
        },
      },
    ],
  },

  '2026-09-23': {
    date: '2026-09-23',
    meetingSlug: '2026-09-23-regular',
    videoId: 'HBQ0eTWe5GE',
    overviewEn:
      'In a 2-hour-14-minute Regular meeting (with Trustee Wells participating remotely under AB 2449 / Brown Act teleconference rules), the Board heard public comment from Garfield and Orion parents and RCTA leadership on school capacity and grade configurations, unanimously approved the 2026-27 Enrollment & Capacity Review next steps (5–0 roll call), unanimously approved the 2025-26 Unaudited Actuals financial close (5–0 roll call), and adopted the Gann Appropriations Limit (4–0 roll call).',
    overviewEs:
      'En una reunión ordinaria de 2 horas y 14 minutos (con participación remota del miembro de la Junta Wells), la Junta escuchó comentarios públicos de familias de Garfield y Orion y de la dirigencia sindical RCTA sobre la capacidad escolar y configuración de grados, aprobó por unanimidad los próximos pasos de la Revisión de Matrícula y Capacidad 2026-27 (votación nominal 5–0), aprobó el Cierre Financiero No Auditado 2025-26 (5–0) y adoptó el Límite de Apropiaciones Gann (4–0).',
    corrections: [],
    items: [
      {
        itemLabel: '9.1',
        titleEn: '2026–27 Annual Enrollment and Capacity Review & Approval of Next Steps for Facility and Program Planning',
        titleEs: 'Revisión Anual de Matrícula y Capacidad 2026–27 y Aprobación de Próximos Pasos para Planificación de Instalaciones y Programas',
        proposal: {
          textEn:
            'Presents Day-10 enrollment (6,199 students across 12 schools vs. 12,362 gross facility capacity, ~50% utilization) and requests approval of Superintendent Dr. Rubalcaba’s two-track study process: (1) Bayside capacity and middle-school access, and (2) Orion and small-school classroom capacity, returning for Board decision in Dec 2027 / Jan 2028 for Fall 2028-29 implementation.',
          textEs:
            'Presenta la matrícula al Día 10 (6,199 alumnos frente a 12,362 lugares de capacidad física, ~50% de ocupación) y solicita aprobar el proceso de dos estudios recomendado por el Superintendente Dr. Rubalcaba: (1) capacidad en Bayside y acceso a secundaria, y (2) capacidad de aulas en Orion y escuelas pequeñas, con decisión prevista en dic. 2027 / ene. 2028 para implementarse en otoño de 2028-29.',
          citations: [
            {
              labelEn: '2026-27 Annual Enrollment & Capacity Review Deck (Updated 9/23/26)',
              labelEs: 'Presentación de Matrícula y Capacidad 2026-27 (Actualizada 23/09/26)',
              filename: '2026-27-Enrollment-Capacity-Review-26.09.23.-updated.pdf',
              extractionStatus: 'text-extracted',
            },
          ],
        },
        discussion: {
          summaryEn:
            'Seven public commenters ([62:03]–[78:48])—including Garfield parents Joanna Mora and Yaneth Vasquez, Garfield Community School Coordinator Yadira De Siena, RCTA President Christy Herrera, Orion parent Jenna Wachtel Pronovost, and resident Carl Landers—spoke on reopening middle-school grades (6–8) at Garfield in North Fair Oaks, addressing near-term TK/Mandarin Immersion classroom pressure at Orion before 2028, and aligning Measure S bond spending with long-term site plans. Trustees expressed strong support for the transparent utilization numbers and community engagement timeline.',
          summaryEs:
            'Siete oradores públicos ([62:03]–[78:48]) —incluidas madres y personal de Garfield, la presidenta de RCTA Christy Herrera, una madre de Orion y vecinos— pidieron evaluar la reapertura de grados de secundaria (6.º a 8.º) en Garfield para North Fair Oaks, atender la presión de aulas en Orion antes de 2028 y alinear el gasto del bono Medida S con el plan maestro. La Junta respaldó la transparencia de los datos y el proceso participativo.',
          highlights: [
            {
              speakerLabelEn: 'Garfield Parents & Staff (Joanna Mora, Yadira De Siena, Yaneth Vasquez) & RCTA President Christy Herrera',
              speakerLabelEs: 'Familias y Personal de Garfield (Joanna Mora, Yadira De Siena, Yaneth Vasquez) y Presidenta de RCTA Christy Herrera',
              attributionScope: 'interval-verified',
              startSeconds: 3723,
              endSeconds: 4728,
              textEn:
                'Garfield speakers urged the Board to expand Garfield back into a K–8 school so North Fair Oaks students can remain in their community through middle school, while Orion parent Jenna Wachtel Pronovost ([70:35]) urged earlier engagement on Orion classroom capacity and Carl Landers ([68:45]) urged macro-level facility decisions before further Measure S spending.',
              textEs:
                'Oradoras de Garfield pidieron ampliar nuevamente la escuela hasta 8.º grado para la comunidad de North Fair Oaks, mientras que la madre de Orion Jenna Wachtel Pronovost ([70:35]) solicitó adelantar el diálogo sobre el espacio en Orion y Carl Landers ([68:45]) pidió definir el plan macro de planteles antes de comprometer más fondos de la Medida S.',
            },
            {
              speakerLabelEn: 'Trustee Mike Wells, Vice President Cecilia I. Márquez & President David Weekly',
              speakerLabelEs: 'Miembro de la Junta Mike Wells, Vicepresidenta Cecilia I. Márquez y Presidente David Weekly',
              attributionScope: 'interval-verified',
              startSeconds: 5280,
              endSeconds: 5543,
              textEn:
                'Trustee Wells ([88:00]), Vice President Márquez ([88:39]), and President Weekly ([89:48]) commended Superintendent Rubalcaba for publishing clear school-by-school capacity numbers and welcomed early engagement from Garfield and Orion families ahead of the formal study process.',
              textEs:
                'El miembro de la Junta Wells ([88:00]), la Vicepresidenta Márquez ([88:39]) y el Presidente Weekly ([89:48]) reconocieron al Superintendente Rubalcaba por publicar cifras claras de capacidad por escuela y celebraron la participación temprana de las familias de Garfield y Orion.',
            },
          ],
        },
        motion_recorded: {
          status: 'provisional-video-tally',
          voteType: 'roll-call',
          tally: '5–0 (Unanimous Roll-Call Vote)',
          startSeconds: 5544,
          textEn:
            'Motion to approve the Superintendent’s recommended next steps for facility and program planning carried 5–0 by roll-call vote at [92:32] (Ayes: Wells, Li, Ng Kwing King, Márquez, Weekly).',
          textEs:
            'La moción para aprobar los próximos pasos recomendados por el Superintendente para la planificación de instalaciones y programas fue aprobada 5–0 en votación nominal en [92:32] (A favor: Wells, Li, Ng Kwing King, Márquez, Weekly).',
        },
        minutes_reconciled: {
          status: 'draft-in-subsequent-packet',
          approvedAtDate: '2026-10-28',
          minutesUrl: `${R2_BASE}/board-packets/2026-10-28/2026.09.23-Minutes-DRAFT.pdf`,
          textEn:
            'Draft minutes published in the October 28, 2026 board packet (Consent Item 10.1) confirm unanimous 5–0 approval of Item 9.1.',
          textEs:
            'El borrador de actas publicado en el paquete del 28 de octubre de 2026 (Punto de Consentimiento 10.1) confirma la aprobación unánime 5–0 del Punto 9.1.',
        },
      },
      {
        itemLabel: '9.4 & 9.5',
        titleEn: '2025-26 Unaudited Actuals Financial Report & Resolution No. 10 (Gann Appropriations Limit)',
        titleEs: 'Informe Financiero de Resultados No Auditados 2025-26 y Resolución N.º 10 (Límite de Apropiaciones Gann)',
        proposal: {
          textEn:
            'Approves the 2025-26 Unaudited Actuals year-end financial report ($147.48M General Fund revenues before $11.0M RDA interfund transfer; $157.22M expenditures; $18.38M ending fund balance; ~4.0% reserve) and adopts Resolution No. 10 establishing the 2025-26 Gann Limit at $94,351,626.61.',
          textEs:
            'Aprueba el informe financiero anual de Resultados No Auditados 2025-26 ($147.48M en ingresos del Fondo General antes de la transferencia RDA de $11.0M; $157.22M en gastos; saldo final de $18.38M; ~4.0% de reserva) y adopta la Resolución N.º 10 fijando el Límite Gann 2025-26 en $94,351,626.61.',
          citations: [
            {
              labelEn: '2025-26 Unaudited Actuals SACS Financial Book',
              labelEs: 'Libro Financiero SACS de Resultados No Auditados 2025-26',
              filename: '25.26-Unaudited-Actuals-Book.pdf',
              extractionStatus: 'text-extracted',
            },
            {
              labelEn: '2025-26 Unaudited Actuals Presentation Deck',
              labelEs: 'Presentación de Resultados No Auditados 2025-26',
              filename: '25-26-UA-Presentation.pdf',
              extractionStatus: 'text-extracted',
            },
          ],
        },
        discussion: {
          summaryEn:
            'Following CBO Rick Edson’s presentation ([94:48]), Clerk Ng Kwing King asked about textbook/curriculum adoption costs and Assistant Superintendent Anna Herrera noted an upcoming ELA adoption timeline ([106:14]). Trustee Wells asked about deferred restricted expenditures and federal revenue variances; CBO Edson noted that unspent 2025-26 categorical funds remain in restricted ending balances and flagged lower-than-expected federal revenue as an item to watch ([107:30]–[108:56]).',
          summaryEs:
            'Tras la presentación del Director de Finanzas (CBO) Rick Edson ([94:48]), la Secretaria Ng Kwing King preguntó sobre los costos de adopción de materiales educativos ([106:14]). El miembro de la Junta Wells preguntó sobre los fondos restringidos diferidos y la variación en ingresos federales; el CBO Edson explicó que los fondos no ejercidos permanecen en saldos restringidos y señaló la necesidad de vigilar los ingresos federales ([107:30]–[108:56]).',
          highlights: [
            {
              speakerLabelEn: 'Clerk Jennifer Ng Kwing King & Assistant Superintendent Anna Herrera',
              speakerLabelEs: 'Secretaria Jennifer Ng Kwing King y Superintendente Asistente Anna Herrera',
              attributionScope: 'interval-verified',
              startSeconds: 6374,
              endSeconds: 6442,
              textEn:
                'Clerk Ng Kwing King asked whether upcoming curriculum adoptions drove the books/supplies variance; Assistant Superintendent Herrera noted that middle-school math was adopted last year and the state ELA adoption list is expected in November.',
              textEs:
                'La Secretaria Ng Kwing King preguntó si las próximas adopciones curriculares explicaban la variación en libros y materiales; la Superintendente Asistente Herrera indicó que matemáticas de secundaria se adoptó el año pasado y que la lista estatal de artes del lenguaje (ELA) se espera en noviembre.',
            },
            {
              speakerLabelEn: 'Trustee Mike Wells & Chief Business Official Rick Edson',
              speakerLabelEs: 'Miembro de la Junta Mike Wells y Director de Finanzas (CBO) Rick Edson',
              attributionScope: 'interval-verified',
              startSeconds: 6450,
              endSeconds: 6565,
              textEn:
                'Trustee Wells asked where deferred 2025-26 spending sits and whether state/local revenue variances were one-time; CBO Rick Edson explained that deferred items sit in restricted ending fund balances and highlighted lower-than-expected federal revenues as a key risk area while noting the district’s ~4% reserve.',
              textEs:
                'El miembro de la Junta Wells preguntó dónde se contabilizan los gastos diferidos de 2025-26 y las variaciones de ingresos; el CBO Rick Edson explicó que los recursos diferidos permanecen en el saldo restringido y destacó los menores ingresos federales como un punto a vigilar, resaltando la reserva del ~4%.',
            },
          ],
        },
        motion_recorded: {
          status: 'provisional-video-tally',
          voteType: 'roll-call',
          tally: 'Item 9.4: 5–0 Roll Call | Item 9.5: 4–0 Roll Call',
          startSeconds: 6795,
          textEn:
            'Item 9.4 (Unaudited Actuals) approved 5–0 by roll-call vote at [113:26] (Ayes: Wells, Li, Ng Kwing King, Márquez, Weekly). Item 9.5 (Resolution No. 10, Gann Limit) approved 4–0 by roll-call vote at [114:34] (Ayes: Li, Ng Kwing King, Márquez, Weekly).',
          textEs:
            'El Punto 9.4 (Resultados No Auditados) se aprobó 5–0 en votación nominal en [113:26] (A favor: Wells, Li, Ng Kwing King, Márquez, Weekly). El Punto 9.5 (Resolución N.º 10, Límite Gann) se aprobó 4–0 en votación nominal en [114:34] (A favor: Li, Ng Kwing King, Márquez, Weekly).',
        },
        minutes_reconciled: {
          status: 'draft-in-subsequent-packet',
          approvedAtDate: '2026-10-28',
          minutesUrl: `${R2_BASE}/board-packets/2026-10-28/2026.09.23-Minutes-DRAFT.pdf`,
          textEn:
            'Draft minutes published in the October 28, 2026 packet (Consent Item 10.1) record unanimous approval of the 2025-26 Unaudited Actuals (9.4) and Resolution No. 10 Gann Limit (9.5).',
          textEs:
            'El borrador de actas publicado en el paquete del 28 de octubre de 2026 (Punto de Consentimiento 10.1) registra la aprobación de los Resultados No Auditados 2025-26 (9.4) y la Resolución N.º 10 sobre el Límite Gann (9.5).',
        },
      },
      {
        itemLabel: '6.1 & 8',
        titleEn: 'MTSS Attendance & Suspension Reduction Report (LCAP Goal 1) & Consent Calendar Approval',
        titleEs: 'Informe MTSS de Asistencia y Reducción de Suspensiones (Meta 1 del LCAP) y Aprobación del Consentimiento',
        proposal: {
          textEn:
            'Item 6.1 updates the Board on Multi-Tiered Systems of Support (MTSS) for attendance and suspension reduction (chronic absenteeism at 9.11% as of Sept 9, 2026). Section 8 bundles 16 Consent items including Air Education tutoring ($204,375), Kennedy Measure U Addendum 1 ($195,228 reallocated), Amergis SpEd behavior technicians amendment (+$142,920 to $294,920), Siemens fire/life safety ($97,224), and Board Bylaw 9250 ($1,200/mo fixed trustee stipend).',
          textEs:
            'El Punto 6.1 informa sobre el sistema MTSS para mejorar la asistencia y reducir suspensiones (ausentismo crónico en 9.11% al 9 de septiembre de 2026). La Sección 8 agrupa 16 puntos de consentimiento, incluidos Air Education ($204,375), Adenda 1 de Medida U en Kennedy ($195,228), enmienda con Amergis (+$142,920 hasta $294,920), Siemens ($97,224) y el Estatuto 9250 ($1,200/mes de estipendio fijo).',
          citations: [
            {
              labelEn: 'Board Bylaw 9250 Remuneration, Reimbursement & Other Benefits (Item 8.12)',
              labelEs: 'Estatuto 9250 Remuneración y Beneficios (Punto 8.12)',
              filename: 'BB-9250-Remuneration-Reimbursement-And-Other-Benefits-Marked.pdf',
              extractionStatus: 'text-extracted',
            },
          ],
        },
        discussion: {
          summaryEn:
            'Staff presented early-year chronic absenteeism data ([18:43]) and trustees discussed site-level attendance outreach ([28:25]–[50:00]). All 16 Consent Calendar items in Section 8 were approved together on a single 5–0 roll-call vote without any items pulled.',
          summaryEs:
            'El personal presentó los datos de ausentismo crónico ([18:43]) y la Junta dialogó sobre las estrategias de seguimiento por escuela ([28:25]–[50:00]). Los 16 puntos del Calendario de Consentimiento en la Sección 8 se aprobaron juntos en una sola votación nominal 5–0.',
          highlights: [
            {
              speakerLabelEn: 'Assistant Superintendent Anna Herrera, Director Patrinia Redd & Board Trustees',
              speakerLabelEs: 'Superintendente Asistente Anna Herrera, Directora Patrinia Redd y Mesa Directiva',
              attributionScope: 'interval-verified',
              startSeconds: 1123,
              endSeconds: 3000,
              textEn:
                'Educational Services and Student Services staff reviewed Day-15/early-September chronic absenteeism (9.11% districtwide, ranging from 4% at Orion to 15% at McKinley) and tiered SART/SARB family support interventions.',
              textEs:
                'El equipo de Servicios Educativos y Estudiantiles revisó el ausentismo crónico al inicio del ciclo (9.11% en el distrito, desde 4% en Orion hasta 15% en McKinley) y las intervenciones de apoyo familiar.',
            },
            {
              speakerLabelEn: 'Board of Trustees (Section 8 Consent Roll-Call Vote)',
              speakerLabelEs: 'Mesa Directiva (Votación Nominal de Consentimiento — Sección 8)',
              attributionScope: 'interval-verified',
              startSeconds: 3009,
              endSeconds: 3060,
              textEn:
                'Section 8 Consent Calendar (Items 8.1–8.16) approved 5–0 by roll-call vote at [50:55].',
              textEs:
                'El Calendario de Consentimiento de la Sección 8 (Puntos 8.1–8.16) se aprobó 5–0 en votación nominal en [50:55].',
            },
          ],
        },
        motion_recorded: {
          status: 'provisional-video-tally',
          voteType: 'roll-call',
          tally: '5–0 (Unanimous Roll-Call Vote on Section 8 Consent)',
          startSeconds: 3055,
          textEn:
            'Item 6.1 was an information report (no vote). Section 8 Consent Calendar (Items 8.1–8.16) passed 5–0 by roll-call vote at [50:55].',
          textEs:
            'El Punto 6.1 fue un informe sin votación. El Calendario de Consentimiento de la Sección 8 (Puntos 8.1–8.16) se aprobó 5–0 en votación nominal en [50:55].',
        },
        minutes_reconciled: {
          status: 'draft-in-subsequent-packet',
          approvedAtDate: '2026-10-28',
          minutesUrl: `${R2_BASE}/board-packets/2026-10-28/2026.09.23-Minutes-DRAFT.pdf`,
          textEn:
            'Draft minutes published in the October 28, 2026 packet (Consent Item 10.1) confirm 5–0 adoption of the Section 8 Consent Calendar.',
          textEs:
            'El borrador de actas publicado en el paquete del 28 de octubre de 2026 (Punto 10.1) confirma la adopción 5–0 del Calendario de Consentimiento de la Sección 8.',
        },
      },
    ],
  },
};

async function buildRecapForDate(date) {
  const base = REVIEWED_RECAPS[date];
  if (!base) {
    throw new Error(`No reviewed deliberation recap definition found for ${date}`);
  }
  const meeting = getMeetingByDate(date);
  const simbliUrl =
    meeting?.simbli ||
    (meeting?.mid
      ? `https://simbli.eboardsolutions.com/SB_Meetings/ViewMeeting.aspx?S=36030397&MID=${meeting.mid}`
      : 'https://simbli.eboardsolutions.com/SB_Meetings/SB_MeetingListing.aspx?S=36030397');

  const items = [];
  for (const item of base.items) {
    const citations = await enrichCitationArtifacts(ROOT, date, item.proposal.citations);
    const highlights = item.discussion.highlights.map((hl) => ({
      ...hl,
      timestampDisplay: `${formatTimestamp(hl.startSeconds)}–${formatTimestamp(hl.endSeconds)}`,
    }));
    const motion = {
      ...item.motion_recorded,
      timestampDisplay:
        item.motion_recorded.startSeconds != null
          ? formatTimestamp(item.motion_recorded.startSeconds)
          : null,
    };
    items.push({
      itemLabel: item.itemLabel,
      titleEn: item.titleEn,
      titleEs: item.titleEs,
      proposal: {
        ...item.proposal,
        citations,
      },
      discussion: {
        ...item.discussion,
        highlights,
      },
      motion_recorded: motion,
      minutes_reconciled: item.minutes_reconciled,
    });
  }

  const doc = {
    _metadata: {
      source: simbliUrl,
      videoSource: `https://www.youtube.com/watch?v=${base.videoId}`,
      transcriptSource: `${R2_BASE}/transcripts/${date}.json`,
      chapterMarkersSource: 'data/chapter-markers.json',
      triageSource: `data/triage/${date}.md`,
      scrapedAt: meeting?.scrapedAt || '2026-10-29T20:50:00Z',
      generatedAt: '2026-10-29T20:50:00Z',
      method:
        'Evidence-typed post-meeting recap enforcing 4-layer separation (proposal, discussion, motion_recorded, minutes_reconciled) and interval-verified speaker attribution.',
      reviewStatus: 'human-reviewed',
    },
    date: base.date,
    meetingSlug: base.meetingSlug,
    videoId: base.videoId,
    overviewEn: base.overviewEn,
    overviewEs: base.overviewEs,
    agendaReorderNoteEn: base.agendaReorderNoteEn || null,
    agendaReorderNoteEs: base.agendaReorderNoteEs || null,
    corrections: base.corrections || [],
    items,
  };

  const validation = validateDeliberationRecap(doc);
  if (!validation.valid) {
    const msg = validation.errors.map((e) => `${e.path}: ${e.message}`).join('; ');
    throw new Error(`Invalid deliberation recap for ${date}: ${msg}`);
  }

  return doc;
}

async function main() {
  const outDir = resolve(ROOT, 'data/deliberation-recaps');
  mkdirSync(outDir, { recursive: true });

  const dates = Object.keys(REVIEWED_RECAPS).sort().reverse();
  const indexEntries = [];

  for (const date of dates) {
    const recap = await buildRecapForDate(date);
    const outPath = resolve(outDir, `${date}.json`);
    writeFileSync(outPath, JSON.stringify(recap, null, 2) + '\n');
    indexEntries.push({
      date: recap.date,
      meetingSlug: recap.meetingSlug,
      videoId: recap.videoId,
      itemsCount: recap.items.length,
      correctionsCount: recap.corrections.length,
      path: `data/deliberation-recaps/${date}.json`,
    });
    console.log(
      `[+] data/deliberation-recaps/${date}.json (${recap.items.length} evidence-typed items verified)`
    );
  }

  const indexDoc = {
    _metadata: {
      source: 'https://simbli.eboardsolutions.com/SB_Meetings/SB_MeetingListing.aspx?S=36030397',
      scrapedAt: '2026-10-29T20:50:00Z',
      method: 'Compiled by scripts/generate-deliberation-recap.mjs from evidence-typed recaps.',
    },
    recaps: indexEntries,
  };
  const indexPath = resolve(outDir, 'index.json');
  writeFileSync(indexPath, JSON.stringify(indexDoc, null, 2) + '\n');
  console.log(`[+] data/deliberation-recaps/index.json (${indexEntries.length} recaps indexed)`);

  // Emit v1 dataset provenance sidecar in data/provenance/rcsd.deliberation-recaps.json
  const artifacts = [];
  for (const date of dates) {
    const p = resolve(outDir, `${date}.json`);
    artifacts.push({
      path: `data/deliberation-recaps/${date}.json`,
      mediaType: 'application/json',
      hash: await hashFile(p),
      bytes: statSync(p).size,
    });
  }
  artifacts.push({
    path: 'data/deliberation-recaps/index.json',
    mediaType: 'application/json',
    hash: await hashFile(indexPath),
    bytes: statSync(indexPath).size,
  });

  const sources = [];
  for (const date of dates) {
    const memoPath = resolve(ROOT, `data/board-memos/${date}.json`);
    const base = REVIEWED_RECAPS[date];
    sources.push({
      sourceId: `rcsd.youtube.recording.${date}`,
      title: `RCSD Board Meeting Video Recording & Transcript (${date})`,
      publisher: 'Redwood City School District (YouTube / Simbli)',
      url: `https://www.youtube.com/watch?v=${base.videoId}`,
      acquiredAt: '2026-10-29T20:50:00Z',
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
    datasetId: 'rcsd.deliberation-recaps',
    districtId: 'ca.cde.district.4169005',
    kind: 'derived',
    artifacts,
    authority: {
      status: 'derived',
      officialLanguage: 'en-US',
      notes:
        'Evidence-typed post-meeting deliberation recaps separating packet proposals, timestamped video discussion, provisional spoken votes, and reconciled minutes.',
    },
    reportingPeriod: {
      from: dates[dates.length - 1],
      to: dates[0],
      label: '2026-27 Recorded RCSD Board Meetings',
    },
    sources,
    lineage: {
      generatedAt: '2026-10-29T20:50:00Z',
      generator: {
        script: 'scripts/generate-deliberation-recap.mjs',
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
      checkedAt: '2026-10-29T20:50:00Z',
    },
  };

  const schemaCheck = validateJsonSchema('dataset', provenanceDoc);
  const domainCheck = validateDatasetProvenance(provenanceDoc);
  if (!schemaCheck.valid || !domainCheck.valid) {
    throw new Error(
      `Invalid rcsd.deliberation-recaps provenance: ${JSON.stringify([
        ...(schemaCheck.errors || []),
        ...(domainCheck.errors || []),
      ])}`
    );
  }
  const provOut = resolve(ROOT, 'data/provenance/rcsd.deliberation-recaps.json');
  writeFileSync(provOut, JSON.stringify(provenanceDoc, null, 2) + '\n');
  console.log('[+] data/provenance/rcsd.deliberation-recaps.json (v1 provenance verified)');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
