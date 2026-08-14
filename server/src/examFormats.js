/**
 * SecureAIExam — Examination format catalogue (source of truth)
 *
 * Every enforceable rule about a question paper lives here: how many
 * sections, which subjects, how many questions of which type per section,
 * marks per correct answer, negative marking, unattempted marks, duration.
 *
 * The Node service owns this file because the rules must be enforced on the
 * backend — the mobile app fetches the same catalogue over
 * GET /api/exam-formats so the UI can never disagree with the validator.
 *
 * Data source: "INDIA EXAMINATION FORMAT DATABASE — reference year 2026".
 * Formats that the reference specifies completely enough to enforce carry
 * `enforced: true` and a full blueprint. Formats the reference explicitly
 * leaves to the yearly brochure carry `enforced: false`: they still appear
 * in the dropdown (with subjects, mode and notes) but the paper composer is
 * not constrained, because inventing counts would be worse than not having
 * them.
 *
 * YEARS: patterns change from year to year, so a format is always resolved
 * as (code, year). `official_through` is the last year covered by a published
 * notification; later years are carried forward and flagged `provisional` so
 * the Admin sees that the structure must be re-checked against the official
 * bulletin.
 */

/** Years offered in the Admin dropdown: current + next. */
const YEARS = [2026, 2027];

/** Question types a paper may contain. Mirrors the questions.question_type check. */
const QUESTION_TYPES = ['mcq', 'msq', 'numerical', 'theoretical'];

const TYPE_LABEL = {
  mcq: 'MCQ',
  msq: 'MSQ (multiple correct)',
  numerical: 'Numerical value',
  theoretical: 'Subjective / descriptive',
};

/* ----------------------------- data helpers ------------------------------ */

/**
 * One question-type quota inside a section.
 * `count` is an exact requirement; pass { min, max } instead for the few
 * formats whose reference gives a range (e.g. CLAT's section spread).
 */
function req(questionType, count, marksCorrect, negativeMarks = 0, extra = {}) {
  return {
    question_type: questionType,
    count,
    min: count,
    max: count,
    marks_correct: marksCorrect,
    negative_marks: negativeMarks,
    unattempted_marks: 0,
    ...extra,
  };
}

/** A quota with a min–max range instead of an exact count. */
function range(questionType, min, max, marksCorrect, negativeMarks = 0, extra = {}) {
  return {
    question_type: questionType,
    count: null,
    min,
    max,
    marks_correct: marksCorrect,
    negative_marks: negativeMarks,
    unattempted_marks: 0,
    ...extra,
  };
}

function sec(name, subject, requirements, extra = {}) {
  return { name, subject, requirements, ...extra };
}

/** Uniform single-type section — the common case. */
function simpleSection(name, subject, questionType, count, marksCorrect, negativeMarks, extra = {}) {
  return sec(name, subject, [req(questionType, count, marksCorrect, negativeMarks)], extra);
}

/**
 * GATE-style quota: one marks-tier that accepts several question types, with
 * negative marking that depends on the type actually used.
 */
function tier(types, count, marksCorrect, negativeByType, label) {
  return {
    question_type: null,
    allowed_types: types,
    label,
    count,
    min: count,
    max: count,
    marks_correct: marksCorrect,
    negative_marks: negativeByType,
    unattempted_marks: 0,
  };
}

/* ------------------------------- catalogue -------------------------------- */

/** Formats whose structure the reference pins down well enough to enforce. */
const ENFORCED = [
  {
    code: 'jee-main-paper-1',
    name: 'JEE Main — Paper 1 (B.E./B.Tech.)',
    body: 'National Testing Agency (NTA)',
    category: 'Engineering / Science entrance',
    mode: 'Computer Based Test',
    source_url: 'https://jeemain.nta.nic.in/information-bulletin/',
    official_through: 2026,
    blueprint: {
      duration_minutes: 180,
      sections: ['Physics', 'Chemistry', 'Mathematics'].map((s) =>
        sec(s, s, [req('mcq', 20, 4, 1), req('numerical', 5, 4, 0)])
      ),
      notes: [
        'The 2026 pattern is 20 MCQ + 5 numerical-value questions per subject. The older 20 + 10 description is not current.',
        'Numerical-value questions carry no negative marking.',
      ],
    },
  },
  {
    code: 'neet-ug',
    name: 'NEET UG',
    body: 'National Testing Agency (NTA)',
    category: 'Medical / Health science',
    mode: 'Pen-and-paper (OMR)',
    source_url: 'https://neet.nta.nic.in/',
    official_through: 2026,
    blueprint: {
      duration_minutes: 200,
      sections: ['Physics', 'Chemistry', 'Botany', 'Zoology'].map((s) =>
        simpleSection(s, s, 'mcq', 45, 4, 1)
      ),
      notes: ['Four options, one correct. This is not a subjective written-answer paper.'],
    },
  },
  {
    code: 'bitsat-mathematics',
    name: 'BITSAT (Mathematics stream)',
    body: 'BITS Pilani',
    category: 'Engineering / Science entrance',
    mode: 'Computer Based Test',
    source_url: 'https://www.bitsadmission.com/',
    official_through: 2026,
    blueprint: {
      duration_minutes: 180,
      sections: [
        simpleSection('Physics', 'Physics', 'mcq', 30, 3, 1),
        simpleSection('Chemistry', 'Chemistry', 'mcq', 30, 3, 1),
        simpleSection('English Proficiency', 'English Proficiency', 'mcq', 10, 3, 1),
        simpleSection('Logical Reasoning', 'Logical Reasoning', 'mcq', 20, 3, 1),
        simpleSection('Mathematics', 'Mathematics', 'mcq', 40, 3, 1),
      ],
      notes: [
        'Extra questions may be offered after the first 130 under the official rules; the core paper is 130 questions.',
      ],
    },
  },
  {
    code: 'bitsat-biology',
    name: 'BITSAT (Biology stream)',
    body: 'BITS Pilani',
    category: 'Engineering / Science entrance',
    mode: 'Computer Based Test',
    source_url: 'https://www.bitsadmission.com/',
    official_through: 2026,
    blueprint: {
      duration_minutes: 180,
      sections: [
        simpleSection('Physics', 'Physics', 'mcq', 30, 3, 1),
        simpleSection('Chemistry', 'Chemistry', 'mcq', 30, 3, 1),
        simpleSection('English Proficiency', 'English Proficiency', 'mcq', 10, 3, 1),
        simpleSection('Logical Reasoning', 'Logical Reasoning', 'mcq', 20, 3, 1),
        simpleSection('Biology', 'Biology', 'mcq', 40, 3, 1),
      ],
      notes: [
        'Extra questions may be offered after the first 130 under the official rules; the core paper is 130 questions.',
      ],
    },
  },
  {
    code: 'comedk-uget',
    name: 'COMEDK UGET',
    body: 'COMEDK',
    category: 'Engineering / Science entrance',
    mode: 'Computer Based Test',
    source_url: 'https://www.comedk.org/',
    official_through: 2026,
    blueprint: {
      duration_minutes: 180,
      sections: ['Physics', 'Chemistry', 'Mathematics'].map((s) =>
        simpleSection(s, s, 'mcq', 60, 1, 0)
      ),
      notes: ['No negative marking.'],
    },
  },
  {
    code: 'clat-ug',
    name: 'CLAT UG',
    body: 'Consortium of National Law Universities',
    category: 'Law entrance',
    mode: 'Computer Based Test',
    source_url: 'https://consortiumofnlus.ac.in/clat-2026/',
    official_through: 2026,
    blueprint: {
      duration_minutes: 120,
      /** The reference gives section spreads, with the paper total fixed at 120. */
      total_questions: 120,
      total_marks: 120,
      sections: [
        sec('English Language', 'English Language', [range('mcq', 22, 26, 1, 0.25)]),
        sec('Current Affairs including General Knowledge', 'Current Affairs & GK', [
          range('mcq', 28, 32, 1, 0.25),
        ]),
        sec('Legal Reasoning', 'Legal Reasoning', [range('mcq', 28, 32, 1, 0.25)]),
        sec('Logical Reasoning', 'Logical Reasoning', [range('mcq', 22, 26, 1, 0.25)]),
        sec('Quantitative Techniques', 'Quantitative Techniques', [range('mcq', 10, 14, 1, 0.25)]),
      ],
      notes: [
        'Section sizes are published as approximate ranges; the paper total is fixed at 120 questions / 120 marks.',
      ],
    },
  },
  {
    code: 'clat-pg',
    name: 'CLAT PG',
    body: 'Consortium of National Law Universities',
    category: 'Law entrance',
    mode: 'Computer Based Test',
    source_url: 'https://consortiumofnlus.ac.in/clat-2026/',
    official_through: 2026,
    blueprint: {
      duration_minutes: 120,
      sections: [
        simpleSection(
          'Objective — Constitutional Law & core law subjects',
          'Law',
          'mcq',
          120,
          1,
          0.25
        ),
      ],
    },
  },
  {
    code: 'cmat',
    name: 'CMAT',
    body: 'National Testing Agency (NTA)',
    category: 'Management entrance',
    mode: 'Computer Based Test',
    source_url: 'https://cmat.nta.nic.in/',
    official_through: 2026,
    blueprint: {
      duration_minutes: 180,
      sections: [
        'Quantitative Techniques & Data Interpretation',
        'Logical Reasoning',
        'Language Comprehension',
        'General Awareness',
        'Innovation & Entrepreneurship',
      ].map((s) => simpleSection(s, s, 'mcq', 20, 4, 1)),
      notes: ['Confirm against the current NTA notification before an actual administration.'],
    },
  },
  {
    code: 'ugc-net',
    name: 'UGC NET',
    body: 'National Testing Agency (NTA)',
    category: 'Teaching / Research',
    mode: 'Computer Based Test',
    source_url: 'https://ugcnet.nta.ac.in/',
    official_through: 2026,
    blueprint: {
      duration_minutes: 180,
      sections: [
        simpleSection('Paper I — Teaching & Research Aptitude', 'General Paper', 'mcq', 50, 2, 0),
        simpleSection('Paper II — Subject', 'Subject Paper', 'mcq', 100, 2, 0),
      ],
      notes: ["No negative marking. Paper II follows the candidate's selected subject."],
    },
  },
  {
    code: 'ctet-paper-1',
    name: 'CTET — Paper I (Classes I–V)',
    body: 'Central Board of Secondary Education',
    category: 'Teaching / Research',
    mode: 'Pen-and-paper (OMR)',
    source_url: 'https://ctet.nic.in/',
    official_through: 2026,
    blueprint: {
      duration_minutes: 150,
      sections: [
        'Child Development & Pedagogy',
        'Mathematics',
        'Environmental Studies',
        'Language I',
        'Language II',
      ].map((s) => simpleSection(s, s, 'mcq', 30, 1, 0)),
      notes: [
        'The reference fixes the paper at 150 MCQs / 150 marks over these five components; the 30-per-component split is the standard even distribution — confirm against the current CBSE bulletin.',
      ],
    },
  },
  {
    code: 'ctet-paper-2-maths-science',
    name: 'CTET — Paper II (Mathematics & Science)',
    body: 'Central Board of Secondary Education',
    category: 'Teaching / Research',
    mode: 'Pen-and-paper (OMR)',
    source_url: 'https://ctet.nic.in/',
    official_through: 2026,
    blueprint: {
      duration_minutes: 150,
      sections: [
        simpleSection('Child Development & Pedagogy', 'Child Development & Pedagogy', 'mcq', 30, 1, 0),
        simpleSection('Mathematics & Science', 'Mathematics & Science', 'mcq', 60, 1, 0),
        simpleSection('Language I', 'Language I', 'mcq', 30, 1, 0),
        simpleSection('Language II', 'Language II', 'mcq', 30, 1, 0),
      ],
      notes: [
        'The reference fixes the paper at 150 MCQs / 150 marks; the 30/60/30/30 split is the standard distribution — confirm against the current CBSE bulletin.',
      ],
    },
  },
  {
    code: 'ctet-paper-2-social-science',
    name: 'CTET — Paper II (Social Studies / Social Science)',
    body: 'Central Board of Secondary Education',
    category: 'Teaching / Research',
    mode: 'Pen-and-paper (OMR)',
    source_url: 'https://ctet.nic.in/',
    official_through: 2026,
    blueprint: {
      duration_minutes: 150,
      sections: [
        simpleSection('Child Development & Pedagogy', 'Child Development & Pedagogy', 'mcq', 30, 1, 0),
        simpleSection('Social Studies / Social Science', 'Social Studies', 'mcq', 60, 1, 0),
        simpleSection('Language I', 'Language I', 'mcq', 30, 1, 0),
        simpleSection('Language II', 'Language II', 'mcq', 30, 1, 0),
      ],
      notes: [
        'The reference fixes the paper at 150 MCQs / 150 marks; the 30/60/30/30 split is the standard distribution — confirm against the current CBSE bulletin.',
      ],
    },
  },
  {
    code: 'gate',
    name: 'GATE',
    body: 'IIT Guwahati (2026 organising institute)',
    category: 'Professional / Technical',
    mode: 'Computer Based Test',
    source_url: 'https://gate2026.iitg.ac.in/question-paper-pattern.html',
    official_through: 2026,
    blueprint: {
      duration_minutes: 180,
      sections: [
        sec('General Aptitude', 'General Aptitude', [
          tier(['mcq', 'msq', 'numerical'], 5, 1, { mcq: 1 / 3, msq: 0, numerical: 0 }, '1-mark questions'),
          tier(['mcq', 'msq', 'numerical'], 5, 2, { mcq: 2 / 3, msq: 0, numerical: 0 }, '2-mark questions'),
        ]),
        sec('Discipline-specific paper', 'Discipline-specific', [
          tier(['mcq', 'msq', 'numerical'], 25, 1, { mcq: 1 / 3, msq: 0, numerical: 0 }, '1-mark questions'),
          tier(['mcq', 'msq', 'numerical'], 30, 2, { mcq: 2 / 3, msq: 0, numerical: 0 }, '2-mark questions'),
        ]),
      ],
      notes: [
        'Negative marking applies to wrong MCQ answers only: −1/3 for a 1-mark MCQ, −2/3 for a 2-mark MCQ.',
        'MSQ and NAT questions carry neither negative marking nor partial marking.',
        'General Aptitude is 10 questions / 15 marks; the discipline paper makes up the remaining 55 questions / 85 marks.',
      ],
    },
  },
  {
    code: 'upsc-cse-prelims-gs1',
    name: 'UPSC CSE Prelims — Paper I (General Studies)',
    body: 'Union Public Service Commission',
    category: 'Civil services',
    mode: 'Pen-and-paper (OMR)',
    source_url: 'https://www.upsc.gov.in/examinations',
    official_through: 2026,
    blueprint: {
      duration_minutes: 120,
      sections: [simpleSection('General Studies I', 'General Studies', 'mcq', 100, 2, 2 / 3)],
      notes: ['A wrong answer costs one-third of the marks allotted to that question.'],
    },
  },
  {
    code: 'upsc-cse-prelims-csat',
    name: 'UPSC CSE Prelims — Paper II (CSAT, qualifying)',
    body: 'Union Public Service Commission',
    category: 'Civil services',
    mode: 'Pen-and-paper (OMR)',
    source_url: 'https://www.upsc.gov.in/examinations',
    official_through: 2026,
    blueprint: {
      duration_minutes: 120,
      sections: [simpleSection('CSAT — Aptitude', 'CSAT', 'mcq', 80, 2.5, 5 / 6)],
      notes: [
        'Qualifying paper (33% required); marks do not count towards the merit list.',
        'A wrong answer costs one-third of the marks allotted to that question.',
      ],
    },
  },
  {
    code: 'upsc-nda-mathematics',
    name: 'UPSC NDA & NA — Mathematics',
    body: 'Union Public Service Commission',
    category: 'Defence',
    mode: 'Pen-and-paper (OMR)',
    source_url: 'https://www.upsc.gov.in/examinations',
    official_through: 2026,
    blueprint: {
      duration_minutes: 150,
      sections: [simpleSection('Mathematics', 'Mathematics', 'mcq', 120, 2.5, 5 / 6)],
      notes: [
        '120 questions / 300 marks. The reference states only that negative marking applies with a paper-specific value; one-third of the question marks is used here — verify against the current notification.',
      ],
    },
  },
  {
    code: 'upsc-nda-gat',
    name: 'UPSC NDA & NA — General Ability Test',
    body: 'Union Public Service Commission',
    category: 'Defence',
    mode: 'Pen-and-paper (OMR)',
    source_url: 'https://www.upsc.gov.in/examinations',
    official_through: 2026,
    blueprint: {
      duration_minutes: 150,
      sections: [
        simpleSection('General Ability Test', 'English & General Knowledge', 'mcq', 150, 4, 4 / 3),
      ],
      notes: [
        '150 questions / 600 marks. The reference states only that negative marking applies with a paper-specific value; one-third of the question marks is used here — verify against the current notification.',
      ],
    },
  },
  {
    code: 'ssc-cgl-tier-1',
    name: 'SSC CGL — Tier I',
    body: 'Staff Selection Commission',
    category: 'SSC',
    mode: 'Computer Based Test',
    source_url: 'https://ssc.gov.in/',
    official_through: 2026,
    blueprint: {
      duration_minutes: 60,
      sections: [
        'General Intelligence & Reasoning',
        'General Awareness',
        'Quantitative Aptitude',
        'English Comprehension',
      ].map((s) => simpleSection(s, s, 'mcq', 25, 2, 0.5)),
      notes: [
        '100 questions / 200 marks. Module-wise negative marking must be taken from the current SSC notice; 0.50 per wrong answer is used here.',
      ],
    },
  },
  {
    code: 'ibps-po-prelims',
    name: 'IBPS PO — Preliminary',
    body: 'Institute of Banking Personnel Selection',
    category: 'Banking / Finance',
    mode: 'Computer Based Test',
    source_url: 'https://www.ibps.in/',
    official_through: 2026,
    blueprint: {
      duration_minutes: 60,
      sections: [
        simpleSection('English Language', 'English Language', 'mcq', 30, 1, 0.25),
        simpleSection('Quantitative Aptitude', 'Quantitative Aptitude', 'mcq', 35, 1, 0.25),
        simpleSection('Reasoning Ability', 'Reasoning Ability', 'mcq', 35, 1, 0.25),
      ],
      notes: ['0.25 mark is deducted per wrong objective answer.'],
    },
  },
  {
    code: 'rrb-group-d-cbt',
    name: 'RRB Group D — CBT',
    body: 'Railway Recruitment Boards',
    category: 'Railways',
    mode: 'Computer Based Test',
    source_url: 'https://www.rrbcdg.gov.in/',
    official_through: 2026,
    blueprint: {
      duration_minutes: 90,
      sections: [
        sec(
          'Computer Based Test',
          'General Science, Mathematics, Reasoning, General Awareness',
          [req('mcq', 100, 1, 1 / 3)],
          {
            subjects: [
              'General Science',
              'Mathematics',
              'General Intelligence & Reasoning',
              'General Awareness / Current Affairs',
            ],
          }
        ),
      ],
      notes: [
        '100 questions / 100 marks with 1/3 negative marking. The reference does not fix a per-subject split or the duration — confirm against the current RRB notification.',
      ],
    },
  },
  {
    code: 'afcat',
    name: 'AFCAT',
    body: 'Indian Air Force',
    category: 'Defence',
    mode: 'Computer Based Test',
    source_url: 'https://afcat.cdac.in/',
    official_through: 2026,
    blueprint: {
      duration_minutes: 120,
      sections: [
        sec('AFCAT', 'General Awareness, English, Numerical Ability, Reasoning', [req('mcq', 100, 3, 1)], {
          subjects: [
            'General Awareness',
            'Verbal Ability in English',
            'Numerical Ability',
            'Reasoning & Military Aptitude',
          ],
        }),
      ],
      notes: [
        '100 questions / 300 marks. EKT may additionally apply to technical candidates.',
        'The reference does not fix a per-subject split.',
      ],
    },
  },
];

/**
 * Formats the reference deliberately leaves to the yearly brochure. They are
 * selectable (so the exam is still tagged with its format and year, and the
 * subject dropdown is still driven by the format) but the strict per-section
 * question quota is not applied — see `enforced: false`.
 *
 * [code, name, body, category, mode, subjects, note]
 */
const REFERENCE_ONLY = [
  ['jee-advanced', 'JEE Advanced (Paper 1 & Paper 2)', 'IITs', 'Engineering / Science entrance', 'Computer Based Test', ['Physics', 'Chemistry', 'Mathematics'], 'Both papers are compulsory. There is no single +4/−1 scheme: partial and negative marking vary by question type, governed by the instructions printed for each section.'],
  ['viteee', 'VITEEE', 'Vellore Institute of Technology', 'Engineering / Science entrance', 'Computer Based Test', ['Mathematics', 'Biology', 'Physics', 'Chemistry', 'Aptitude', 'English'], 'Section and question allocation change between editions — use the current VITEEE brochure.'],
  ['mht-cet-pcm', 'MHT-CET (PCM)', 'State CET Cell, Maharashtra', 'State entrance', 'Computer Based Test', ['Physics', 'Chemistry', 'Mathematics'], 'Subject scoring differs; Mathematics generally carries higher weight. Use the current CET Cell brochure.'],
  ['mht-cet-pcb', 'MHT-CET (PCB)', 'State CET Cell, Maharashtra', 'State entrance', 'Computer Based Test', ['Physics', 'Chemistry', 'Biology'], 'Subject scoring differs by year. Use the current CET Cell brochure.'],
  ['kcet', 'KCET', 'Karnataka Examinations Authority', 'State entrance', 'Offline / OMR', ['Physics', 'Chemistry', 'Mathematics', 'Biology'], 'Separate subject papers; generally +1 with no negative marking. Check the current KEA bulletin.'],
  ['wbjee', 'WBJEE', 'West Bengal Joint Entrance Examinations Board', 'State entrance', 'Offline / OMR', ['Mathematics', 'Physics', 'Chemistry'], 'MCQ categories carry different scoring rules; negative marking applies to some categories and not others. Do not apply one universal rule.'],
  ['ap-eapcet-engineering', 'AP EAPCET (Engineering)', 'APSCHE', 'State entrance', 'Computer Based Test', ['Mathematics', 'Physics', 'Chemistry'], 'Typically +1 with no negative marking; verify the current notification.'],
  ['ts-eapcet-engineering', 'TS EAPCET (Engineering)', 'Telangana Council / JNTUH', 'State entrance', 'Computer Based Test', ['Mathematics', 'Physics', 'Chemistry'], 'Typically +1 with no negative marking; verify the current notification.'],
  ['keam', 'KEAM', 'CEE Kerala', 'State entrance', 'Computer Based Test', ['Physics', 'Chemistry', 'Mathematics'], 'Subject and scoring pattern are defined by the current CEE Kerala notification.'],
  ['gujcet', 'GUJCET', 'Gujarat Secondary & Higher Secondary Education Board', 'State entrance', 'Offline / OMR', ['Physics', 'Chemistry', 'Mathematics', 'Biology'], 'State-specific marking; check the current GSEB notification.'],
  ['ojee', 'OJEE', 'Odisha JEE Board', 'State entrance', 'Computer Based Test', ['Physics', 'Chemistry', 'Mathematics', 'Biology'], 'Course-specific subject combinations and scoring.'],
  ['iat-iiser', 'IAT — IISER Aptitude Test', 'IISERs', 'Engineering / Science entrance', 'Computer Based Test', ['Biology', 'Chemistry', 'Mathematics', 'Physics'], 'The format has been revised across years — check the current IAT admission brochure.'],
  ['nest', 'NEST', 'NISER / CEBS', 'Engineering / Science entrance', 'Computer Based Test', ['Biology', 'Chemistry', 'Mathematics', 'Physics'], 'Section and scoring rules are defined in the annual NEST brochure.'],
  ['neet-pg', 'NEET PG', 'NBEMS', 'Medical / Health science', 'Computer Based Test', ['Medicine', 'Surgery', 'Obstetrics & Gynaecology', 'Preventive & Social Medicine', 'Pre-clinical', 'Para-clinical'], 'Verify subject grouping and marking against the current NBEMS information bulletin.'],
  ['ini-cet', 'INI-CET', 'AIIMS / Institutes of National Importance', 'Medical / Health science', 'Computer Based Test', ['Medicine', 'Surgery', 'Obstetrics & Gynaecology', 'Preventive & Social Medicine'], 'Duration and marking may be updated — check the current INI-CET prospectus.'],
  ['neet-ss', 'NEET SS', 'NBEMS', 'Medical / Health science', 'Computer Based Test', ['Super-speciality feeder subject'], 'Marking and subject grouping are defined by the current NEET-SS bulletin.'],
  ['ailet-ug', 'AILET UG', 'National Law University Delhi', 'Law entrance', 'Offline / OMR', ['English', 'Current Affairs & GK', 'Logical Reasoning'], 'Negative marking applies; the annual question distribution is set by the NLU Delhi notification.'],
  ['cat', 'CAT', 'Indian Institutes of Management', 'Management entrance', 'Computer Based Test', ['VARC', 'DILR', 'Quantitative Ability'], 'MCQs are generally +3 / −1 and non-MCQ (TITA) questions carry no negative marking, but the question count and section timing change by year.'],
  ['xat', 'XAT', 'XLRI', 'Management entrance', 'Computer Based Test', ['Verbal Ability & Logical Reasoning', 'Decision Making', 'Quantitative Ability & Data Interpretation', 'General Knowledge'], 'Rules have changed over time — take the penalty and GK treatment from the current XAT bulletin.'],
  ['mat', 'MAT', 'All India Management Association', 'Management entrance', 'PBT / CBT / IBT', ['Language Comprehension', 'Intelligence & Critical Reasoning', 'Mathematical Skills', 'Data Analysis & Sufficiency', 'Economic & Business Environment'], 'Marking and question count vary by test option and edition.'],
  ['atma', 'ATMA', 'AIMS', 'Management entrance', 'Computer Based Test', ['Analytical Reasoning', 'Quantitative Skills', 'Verbal Skills'], 'Negative marking applies; take the exact penalty from the official ATMA bulletin.'],
  ['ap-icet', 'AP ICET', 'APSCHE', 'Management entrance', 'Computer Based Test', ['Analytical Ability', 'Mathematical Ability', 'Communication Ability'], 'The current state notification governs the exact pattern.'],
  ['ts-icet', 'TS ICET', 'Telangana Council', 'Management entrance', 'Computer Based Test', ['Analytical Ability', 'Mathematical Ability', 'Communication Ability'], 'The current state notification governs the exact pattern.'],
  ['mah-mba-cet', 'MAH MBA/MMS CET', 'State CET Cell, Maharashtra', 'Management entrance', 'Computer Based Test', ['Logical Reasoning', 'Abstract Reasoning', 'Quantitative Aptitude', 'Verbal Ability / Reading Comprehension'], 'The current CET Cell bulletin governs the exact pattern.'],
  ['upsc-cds-ima', 'UPSC CDS (IMA / INA / AFA)', 'Union Public Service Commission', 'Defence', 'Offline / OMR', ['English', 'General Knowledge', 'Elementary Mathematics'], 'Negative marking applies to the objective papers; followed by the SSB interview. All three written papers are sat the same day, in different shifts.'],
  ['upsc-cds-ota', 'UPSC CDS (OTA)', 'Union Public Service Commission', 'Defence', 'Offline / OMR', ['English', 'General Knowledge'], 'Negative marking applies to the objective papers; followed by the SSB interview.'],
  ['upsc-capf-ac', 'UPSC CAPF (AC)', 'Union Public Service Commission', 'Defence', 'Objective + descriptive', ['General Ability and Intelligence', 'General Studies, Essay and Comprehension'], 'Paper I is objective with negative marking; Paper II is descriptive. Both papers are sat the same day, Paper I in the morning and Paper II in the afternoon.'],
  ['upsc-cms', 'UPSC Combined Medical Services', 'Union Public Service Commission', 'Medical / Health science', 'Computer Based Test', ['General Medicine', 'Paediatrics', 'Surgery', 'Gynaecology & Obstetrics', 'Preventive & Social Medicine'], 'Two objective papers totalling 500 marks, followed by a personality test.'],
  ['upsc-ifos', 'UPSC Indian Forest Service (Mains)', 'Union Public Service Commission', 'Civil services', 'Descriptive', ['General English', 'General Knowledge', 'Optional subject I', 'Optional subject II'], 'Screened through the CSE preliminary examination; the main examination is descriptive.'],
  ['ssc-chsl-tier-1', 'SSC CHSL — Tier I', 'Staff Selection Commission', 'SSC', 'Computer Based Test', ['English Language', 'General Intelligence', 'Quantitative Aptitude', 'General Awareness'], '100 MCQs / 200 marks with negative marking; the reference does not fix the per-subject split.'],
  ['ssc-mts', 'SSC MTS', 'Staff Selection Commission', 'SSC', 'Computer Based Test', ['Numerical and Mathematical Ability', 'Reasoning Ability and Problem Solving', 'General Awareness', 'English Language and Comprehension'], 'A two-session structure has been used recently; questions, marks and negative marking differ by session.'],
  ['ssc-cpo', 'SSC CPO', 'Staff Selection Commission', 'SSC', 'Computer Based Test', ['General Intelligence & Reasoning', 'General Knowledge & General Awareness', 'Quantitative Aptitude', 'English Comprehension'], 'Paper-I and Paper-II with a physical test in between; negative marking applies.'],
  ['csir-ugc-net', 'CSIR UGC NET', 'National Testing Agency (NTA)', 'Teaching / Research', 'Computer Based Test', ['Chemical Sciences', 'Earth, Atmospheric, Ocean & Planetary Sciences', 'Life Sciences', 'Mathematical Sciences', 'Physical Sciences'], 'Marking and question counts differ by subject and some sections carry negative marking — do not hard-code one common rule.'],
  ['nata', 'NATA', 'Council of Architecture', 'Design / Architecture', 'Objective + drawing', ['Drawing & Visual Aptitude', 'Cognitive Aptitude'], 'Components and marking follow the current Council of Architecture / NATA brochure.'],
  ['uceed', 'UCEED', 'IIT Bombay', 'Design / Architecture', 'Objective + drawing', ['Visualisation & Spatial Ability', 'Observation & Design Sensitivity', 'Analytical & Logical Reasoning', 'Drawing'], 'MCQ, MSQ, NAT and drawing components; negative marking differs by question type.'],
  ['nid-dat', 'NID DAT', 'National Institute of Design', 'Design / Architecture', 'Objective + subjective', ['Design Aptitude', 'Studio / Situational Test'], 'Prelims and mains; marking and question structure change by year.'],
  ['nift-entrance', 'NIFT Entrance (CAT + GAT)', 'National Institute of Fashion Technology', 'Design / Architecture', 'Objective + creative', ['Creative Ability Test', 'General Ability Test'], 'The exact pattern varies by programme and year; a situation test/interview may follow.'],
  ['jam', 'IIT JAM', 'IITs', 'Professional / Technical', 'Computer Based Test', ['Biotechnology', 'Chemistry', 'Economics', 'Geology', 'Mathematics', 'Mathematical Statistics', 'Physics'], 'MCQ, MSQ and NAT sections; MCQs carry negative marking while MSQ/NAT rules differ. Use the current JAM brochure.'],
  ['icg-assistant-commandant', 'Indian Coast Guard — Assistant Commandant', 'Indian Coast Guard', 'Defence', 'Computer Based Test', ['General Awareness', 'English', 'Mathematics', 'Reasoning'], 'Stage structure varies by recruitment cycle; take the question and marking scheme from the current notification.'],
];

/* ---------------------------- school board exams --------------------------- */

/**
 * Class 10 / 11 / 12 board examinations: the central boards, every state board
 * and the UT arrangements.
 *
 * These are theory papers, and they are reference-only by nature rather than by
 * omission. Unlike an entrance exam, a board republishes its blueprint every
 * year — subject-wise marks, section counts, question counts and even duration
 * move with the current sample/specimen paper, and they differ per subject
 * inside the same examination. Pinning a quota here would be inventing one, so
 * the Admin states the counts for the specific subject paper being set, exactly
 * as for any other open format.
 *
 * Sections are the subjects a board commonly offers; a paper is set against the
 * one it is for.
 */
const BOARD_SUBJECTS = {
  10: ['English', 'Second Language', 'Mathematics', 'Science', 'Social Science'],
  11: ['English', 'Physics', 'Chemistry', 'Mathematics', 'Biology', 'Accountancy', 'Business Studies', 'Economics'],
  12: ['English', 'Physics', 'Chemistry', 'Mathematics', 'Biology', 'Accountancy', 'Business Studies', 'Economics', 'History', 'Political Science'],
};

/** What a board theory paper mixes, where the board publishes it specifically. */
const BOARD_NOTES = {
  'cbse-10': 'Commonly 80 theory marks with internal assessment making up the balance, usually 3 hours. Mixes MCQ, assertion–reason, short answer, long answer, case/source-based and competency-based questions. Take exact counts from the annual CBSE sample question paper.',
  'cbse-12': 'Commonly 70 or 80 theory marks alongside practical/project work where prescribed, usually 3 hours. Mixes MCQ, assertion–reason, short answer, numerical, long answer, case-based and competency-based questions. Take exact counts from the annual CBSE sample question paper.',
  'icse-10': 'Commonly 80 theory marks with internal/practical components where prescribed. Mixes objective, short answer, structured, long answer, diagram/map-based and application questions. Take the exact structure from the CISCE specimen paper.',
  'isc-12': 'Commonly 70 or 80 theory marks alongside practical/project components where prescribed. Mixes objective, short answer, numerical, structured, long answer and application questions. Take the exact structure from the CISCE specimen paper.',
};

const BOARD_NOTE_DEFAULT =
  'Theory paper mixing objective/MCQ, very short answer, short answer, long answer, numerical and application/case-based questions, with practical or internal assessment where prescribed. Subject-wise marks, duration and question counts vary by subject and academic year — take them from the board’s current blueprint.';

/** [code, name, board, class] */
const BOARD_EXAMS = [
  ['cbse-10', 'CBSE Class 10 Secondary School Examination', 'Central Board of Secondary Education', 10],
  ['cbse-12', 'CBSE Class 12 Senior School Certificate Examination', 'Central Board of Secondary Education', 12],
  ['icse-10', 'ICSE (Indian Certificate of Secondary Education)', 'Council for the Indian School Certificate Examinations', 10],
  ['isc-12', 'ISC (Indian School Certificate)', 'Council for the Indian School Certificate Examinations', 12],
  ['nios-secondary', 'NIOS Secondary Examination', 'National Institute of Open Schooling', 10],
  ['nios-senior-secondary', 'NIOS Senior Secondary Examination', 'National Institute of Open Schooling', 12],
  ['ap-ssc', 'AP SSC Public Examination', 'Board of Secondary Education, Andhra Pradesh', 10],
  ['ap-inter-1', 'AP Intermediate 1st Year Examination', 'Board of Intermediate Education, Andhra Pradesh', 11],
  ['ap-inter-2', 'AP Intermediate 2nd Year Examination', 'Board of Intermediate Education, Andhra Pradesh', 12],
  ['assam-hslc', 'Assam HSLC Examination', 'Board of Secondary Education, Assam', 10],
  ['assam-hs', 'Assam Higher Secondary Examination', 'Assam Higher Secondary Education Council', 12],
  ['bihar-matric', 'Bihar Matriculation Examination', 'Bihar School Examination Board', 10],
  ['bihar-inter', 'Bihar Intermediate Examination', 'Bihar School Examination Board', 12],
  ['cgbse-10', 'CGBSE High School Examination', 'Chhattisgarh Board of Secondary Education', 10],
  ['cgbse-12', 'CGBSE Higher Secondary Examination', 'Chhattisgarh Board of Secondary Education', 12],
  ['goa-10', 'Goa SSC Examination', 'Goa Board of Secondary and Higher Secondary Education', 10],
  ['goa-12', 'Goa HSSC Examination', 'Goa Board of Secondary and Higher Secondary Education', 12],
  ['gseb-10', 'GSEB SSC Examination', 'Gujarat Secondary and Higher Secondary Education Board', 10],
  ['gseb-12', 'GSEB HSC General/Science Examination', 'Gujarat Secondary and Higher Secondary Education Board', 12],
  ['haryana-10', 'Haryana Secondary Examination', 'Board of School Education Haryana', 10],
  ['haryana-12', 'Haryana Senior Secondary Examination', 'Board of School Education Haryana', 12],
  ['hp-10', 'HPBOSE Matriculation Examination', 'Himachal Pradesh Board of School Education', 10],
  ['hp-12', 'HPBOSE Plus Two Examination', 'Himachal Pradesh Board of School Education', 12],
  ['jkbose-10', 'JKBOSE Class 10 Secondary Examination', 'Jammu and Kashmir Board of School Education', 10],
  ['jkbose-12', 'JKBOSE Class 12 Higher Secondary Examination', 'Jammu and Kashmir Board of School Education', 12],
  ['jac-10', 'JAC Secondary Examination', 'Jharkhand Academic Council', 10],
  ['jac-12', 'JAC Intermediate Examination', 'Jharkhand Academic Council', 12],
  ['karnataka-10', 'Karnataka SSLC Examination', 'Karnataka School Examination and Assessment Board', 10],
  ['karnataka-12', 'Karnataka 2nd PUC Examination', 'Department of Pre-University Education, Karnataka', 12],
  ['kerala-10', 'Kerala SSLC Examination', 'Kerala Board of Public Examinations', 10],
  ['kerala-12', 'Kerala Higher Secondary Examination (Plus Two)', 'Directorate of Higher Secondary Education, Kerala', 12],
  ['mp-10', 'MPBSE High School Certificate Examination', 'Board of Secondary Education, Madhya Pradesh', 10],
  ['mp-12', 'MPBSE Higher Secondary School Certificate Examination', 'Board of Secondary Education, Madhya Pradesh', 12],
  ['maharashtra-10', 'Maharashtra SSC Examination', 'Maharashtra State Board of Secondary and Higher Secondary Education', 10],
  ['maharashtra-12', 'Maharashtra HSC Examination', 'Maharashtra State Board of Secondary and Higher Secondary Education', 12],
  ['manipur-10', 'Manipur HSLC Examination', 'Board of Secondary Education, Manipur', 10],
  ['manipur-12', 'Manipur Higher Secondary Examination', 'Council of Higher Secondary Education, Manipur', 12],
  ['meghalaya-10', 'MBOSE SSLC Examination', 'Meghalaya Board of School Education', 10],
  ['meghalaya-12', 'MBOSE HSSLC Examination', 'Meghalaya Board of School Education', 12],
  ['mizoram-10', 'Mizoram HSLC Examination', 'Mizoram Board of School Education', 10],
  ['mizoram-12', 'Mizoram HSSLC Examination', 'Mizoram Board of School Education', 12],
  ['nagaland-10', 'NBSE HSLC Examination', 'Nagaland Board of School Education', 10],
  ['nagaland-12', 'NBSE HSSLC Examination', 'Nagaland Board of School Education', 12],
  ['odisha-10', 'Odisha HSC Examination', 'Board of Secondary Education, Odisha', 10],
  ['odisha-12', 'Odisha CHSE Higher Secondary Examination', 'Council of Higher Secondary Education, Odisha', 12],
  ['punjab-10', 'PSEB Matriculation Examination', 'Punjab School Education Board', 10],
  ['punjab-12', 'PSEB Senior Secondary Examination', 'Punjab School Education Board', 12],
  ['rajasthan-10', 'RBSE Secondary Examination', 'Board of Secondary Education, Rajasthan', 10],
  ['rajasthan-12', 'RBSE Senior Secondary Examination', 'Board of Secondary Education, Rajasthan', 12],
  ['sikkim-10', 'Sikkim Class 10 Board Examination', 'Board of Open Schooling and Skill Education, Sikkim', 10],
  ['sikkim-12', 'Sikkim Class 12 Board Examination', 'Board of Open Schooling and Skill Education, Sikkim', 12],
  ['tn-10', 'Tamil Nadu SSLC Public Examination', 'Tamil Nadu Directorate of Government Examinations', 10],
  ['tn-12', 'Tamil Nadu HSE +2 Public Examination', 'Tamil Nadu Directorate of Government Examinations', 12],
  ['telangana-10', 'Telangana SSC Public Examination', 'Board of Secondary Education, Telangana', 10],
  ['telangana-12', 'Telangana Intermediate 2nd Year Public Examination', 'Telangana State Board of Intermediate Education', 12],
  ['tripura-10', 'TBSE Madhyamik Examination', 'Tripura Board of Secondary Education', 10],
  ['tripura-12', 'TBSE Higher Secondary Examination', 'Tripura Board of Secondary Education', 12],
  ['up-10', 'UPMSP High School Examination', 'Board of High School and Intermediate Education, Uttar Pradesh', 10],
  ['up-12', 'UPMSP Intermediate Examination', 'Board of High School and Intermediate Education, Uttar Pradesh', 12],
  ['uk-10', 'Uttarakhand High School Examination', 'Uttarakhand Board of School Education', 10],
  ['uk-12', 'Uttarakhand Intermediate Examination', 'Uttarakhand Board of School Education', 12],
  ['wb-10', 'West Bengal Madhyamik Pariksha', 'West Bengal Board of Secondary Education', 10],
  ['wb-12', 'West Bengal Higher Secondary Examination', 'West Bengal Council of Higher Secondary Education', 12],
  ['delhi-10', 'Delhi Class 10 Board Examination (affiliated board)', 'Directorate of Education, Delhi — schools may use CBSE/CISCE', 10],
  ['delhi-12', 'Delhi Class 12 Board Examination (affiliated board)', 'Directorate of Education, Delhi — schools may use CBSE/CISCE', 12],
  ['ladakh-10', 'Ladakh Class 10 Secondary Board Examination', 'Ladakh School Education Department — JKBOSE-linked arrangements', 10],
  ['ladakh-12', 'Ladakh Class 12 Higher Secondary Board Examination', 'Ladakh School Education Department — JKBOSE-linked arrangements', 12],
];

function buildReferenceFormat(row) {
  const [code, name, body, category, mode, subjects, note] = row;
  return {
    code,
    name,
    body,
    category,
    mode,
    source_url: null,
    official_through: 2026,
    enforced: false,
    blueprint: {
      duration_minutes: null,
      sections: subjects.map((s) => sec(s, s, [], { free_form: true })),
      notes: [note, 'The reference does not pin this pattern down, so per-section question quotas are not enforced for this format.'],
    },
  };
}

/** "Social Science" -> "social-science", for building a per-subject format code. */
function slugifySubject(subject) {
  return String(subject)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

/**
 * A board does not administer one combined paper across its subjects — CBSE,
 * ICSE and every state board publish a subject-wise date sheet, and English,
 * Mathematics, Science, Social Science etc. are each sat as their own
 * separate paper on their own separate date (confirmed against the current
 * CBSE 2026 date sheet). Modelling a board as ONE format with a subject per
 * SECTION — as an entrance exam's combined paper does — would let the Admin
 * schedule an exam that is one paper mixing English with Mathematics, which
 * does not exist. Each (board, class, subject) is instead its own format: a
 * single, un-sectioned paper for that one subject.
 */
function boardSubjectFormat([code, name, board, cls], subject) {
  const note = BOARD_NOTES[code] ?? BOARD_NOTE_DEFAULT;
  return {
    code: `${code}-${slugifySubject(subject)}`,
    name: `${name} — ${subject}`,
    body: board,
    category: 'School boards',
    mode: 'Theory (pen & paper)',
    source_url: null,
    official_through: 2026,
    enforced: false,
    blueprint: {
      duration_minutes: null,
      sections: [sec(subject, subject, [], { free_form: true })],
      notes: [
        note,
        'Boards examine each subject as its own separate paper on its own date, not a combined paper — this format is that one subject only.',
        'The reference does not pin this pattern down, so per-section question quotas are not enforced for this format.',
      ],
    },
  };
}

/**
 * Exams administered as several SEPARATE dated papers rather than sections
 * of one sitting — a bank's Prelims and Mains are weeks apart, CA
 * Foundation's four papers fall on four different days, RRB's CBT-1 and
 * CBT-2 are months apart. Bundling these as subject-sections of one format
 * (the way a genuinely combined paper like JEE Advanced is modelled) would
 * let the Admin schedule one paper mixing Prelims questions with Mains
 * questions, which is not how the real exam runs. Each stage below is
 * instead its own format — schedule each on its own real date.
 *
 * Every entry here was checked against the current-cycle (2026) official
 * schedule before being split; where two papers of one stage ARE sat the
 * same day (UPSC CDS's three papers, UPSC CAPF's Paper I/II, GATE's General
 * Aptitude + discipline paper, UGC NET's Paper I/II), the exam is left as
 * ONE format with those as sections — that already matches how the real
 * exam runs, so splitting it further would be wrong in the other direction.
 *
 * [code, name, body, category, mode, stages, note]
 * stages: the separate dated papers, in the order they are sat.
 */
const STAGED_EXAMS = [
  ['sbi-po', 'SBI PO', 'State Bank of India', 'Banking / Finance', 'Objective + descriptive',
    ['Prelims', 'Mains'],
    'Prelims and Mains are held on separate dates, weeks apart (Prelims marks do not count toward the final merit list). Schedule each stage as its own exam on its own date.'],
  ['sbi-clerk', 'SBI Clerk (Junior Associate)', 'State Bank of India', 'Banking / Finance', 'Computer Based Test',
    ['Prelims', 'Mains'],
    'Prelims and Mains are held on separate dates, weeks apart. Schedule each stage as its own exam on its own date.'],
  ['ibps-clerk', 'IBPS Clerk (CSA)', 'Institute of Banking Personnel Selection', 'Banking / Finance', 'Computer Based Test',
    ['Prelims', 'Mains'],
    'Prelims (qualifying) and Mains (merit-based) are held on separate dates, weeks apart. Schedule each stage as its own exam on its own date.'],
  ['rbi-grade-b', 'RBI Grade B', 'Reserve Bank of India', 'Banking / Finance', 'Objective + descriptive',
    ['Phase 1', 'Phase 2'],
    'Phase 1 (screening) and Phase 2 (Economic & Social Issues, Finance & Management, English writing) are held on separate dates, weeks apart. Schedule each stage as its own exam on its own date.'],
  ['sebi-grade-a', 'SEBI Grade A', 'Securities and Exchange Board of India', 'Banking / Finance', 'Objective + descriptive',
    ['Phase 1', 'Phase 2'],
    'Phase 1 and Phase 2 are held on separate dates, weeks apart. Schedule each stage as its own exam on its own date.'],
  ['upsc-ese', 'UPSC Engineering Services (ESE)', 'Union Public Service Commission', 'Civil services', 'Objective + conventional',
    ['Prelims', 'Mains'],
    'Prelims and Mains are held on separate dates, months apart (Mains itself runs Paper I in the morning and Paper II in the afternoon of the same day). Schedule each stage as its own exam on its own date.'],
  ['ssc-je', 'SSC JE', 'Staff Selection Commission', 'SSC', 'Objective + descriptive',
    ['Paper 1 (objective)', 'Paper 2 (descriptive)'],
    'Paper 1 is a CBT screening stage; only those who clear it sit Paper 2, months later. Schedule each as its own exam on its own date.'],
  ['rrb-ntpc', 'RRB NTPC', 'Railway Recruitment Boards', 'Railways', 'Computer Based Test',
    ['CBT-1', 'CBT-2'],
    'CBT-1 (screening) and CBT-2 are held on separate dates, months apart. Schedule each stage as its own exam on its own date.'],
  ['rrb-je', 'RRB JE', 'Railway Recruitment Boards', 'Railways', 'Computer Based Test',
    ['CBT-1', 'CBT-2'],
    'CBT-1 (screening) and CBT-2 are held on separate dates, months apart. Schedule each stage as its own exam on its own date.'],
  ['ca-foundation', 'CA Foundation', 'ICAI', 'Professional / Technical', 'Objective + descriptive',
    ['Paper 1 — Accounting', 'Paper 2 — Business Laws', 'Paper 3 — Quantitative Aptitude', 'Paper 4 — Business Economics'],
    'ICAI schedules the four papers on four different dates, roughly on alternate days. Schedule each paper as its own exam on its own date.'],
  ['ca-intermediate', 'CA Intermediate', 'ICAI', 'Professional / Technical', 'Objective + descriptive',
    [
      'Group I — Advanced Accounting', 'Group I — Corporate and Other Laws', 'Group I — Taxation',
      'Group II — Cost & Management Accounting', 'Group II — Auditing and Ethics', 'Group II — Financial Management & Strategic Management',
    ],
    'ICAI schedules Group I and Group II on separate date blocks (each group\'s papers on alternate days, the two groups weeks apart). Schedule each paper as its own exam on its own date.'],
  ['cuet-ug', 'CUET UG', 'National Testing Agency (NTA)', 'University entrance', 'Computer Based Test',
    ['Language Test', 'Domain Subject Test', 'General Test'],
    'Candidates sit on whichever date and shift their chosen language/domain/general tests are scheduled — NTA publishes a subject-wise date sheet, not one common exam day. Language/domain tests offer 50 questions with 40 to attempt; the General Test offers 60 with 50 to attempt. Marking is +5 / −1. Schedule each test as its own exam on its own date.'],
];

/** A STAGED_EXAMS row rendered into one stage's standalone, un-sectioned format. */
function stagedExamFormat([code, name, body, category, mode, , note], stage) {
  return {
    code: `${code}-${slugifySubject(stage)}`,
    name: `${name} — ${stage}`,
    body,
    category,
    mode,
    source_url: null,
    official_through: 2026,
    enforced: false,
    blueprint: {
      duration_minutes: null,
      sections: [sec(stage, name, [], { free_form: true })],
      notes: [note, 'The reference does not pin this pattern down, so per-section question quotas are not enforced for this format.'],
    },
  };
}

/** code -> format, with `enforced` defaulted to true for the full blueprints. */
const FORMATS = new Map();
for (const f of ENFORCED) FORMATS.set(f.code, { ...f, enforced: true });
for (const row of REFERENCE_ONLY) {
  const f = buildReferenceFormat(row);
  FORMATS.set(f.code, f);
}
for (const entry of BOARD_EXAMS) {
  const cls = entry[3];
  const subjects = BOARD_SUBJECTS[cls] ?? BOARD_SUBJECTS[12];
  for (const subject of subjects) {
    const f = boardSubjectFormat(entry, subject);
    FORMATS.set(f.code, f);
  }
}
for (const entry of STAGED_EXAMS) {
  const stages = entry[5];
  for (const stage of stages) {
    const f = stagedExamFormat(entry, stage);
    FORMATS.set(f.code, f);
  }
}

/* -------------------------------- resolving -------------------------------- */

const round2 = (n) => Math.round(n * 100) / 100;

/** Marks lost for a wrong answer of `type` under this requirement. */
function negativeFor(requirement, type) {
  const neg = requirement.negative_marks;
  if (neg && typeof neg === 'object') return Number(neg[type] ?? neg.default ?? 0);
  return Number(neg || 0);
}

/** Question types a requirement accepts. */
function typesFor(requirement) {
  if (requirement.allowed_types) return requirement.allowed_types;
  return requirement.question_type ? [requirement.question_type] : QUESTION_TYPES;
}

/** Human-readable quota, e.g. "20 MCQ" or "22–26 MCQ". */
function requirementLabel(requirement) {
  if (requirement.display_label) return requirement.display_label;
  const types = typesFor(requirement)
    .map((t) => TYPE_LABEL[t] ?? t)
    .join(' / ');
  const n =
    requirement.count != null ? `${requirement.count}` : `${requirement.min}–${requirement.max}`;
  return requirement.label ? `${n} × ${requirement.label}` : `${n} ${types}`;
}

/** Totals derived from a blueprint's sections (never hand-maintained). */
function computeTotals(sections, blueprint) {
  let min = 0;
  let max = 0;
  let marksMin = 0;
  let marksMax = 0;
  for (const section of sections) {
    for (const r of section.requirements) {
      min += r.min ?? 0;
      max += r.max ?? 0;
      marksMin += (r.min ?? 0) * r.marks_correct;
      marksMax += (r.max ?? 0) * r.marks_correct;
    }
  }
  const fixedQuestions = blueprint.total_questions ?? (min === max ? min : null);
  return {
    questions_min: min,
    questions_max: max,
    questions: fixedQuestions,
    marks_min: round2(marksMin),
    marks_max: round2(marksMax),
    marks: marksMin === marksMax ? round2(marksMin) : blueprint.total_marks ?? null,
  };
}

/**
 * Resolve a format for a specific year. Later years inherit the last
 * published blueprint and are flagged `provisional` — the caller (Admin UI)
 * surfaces that so the pattern gets re-checked against the notification.
 */
function resolveFormat(code, year) {
  const format = FORMATS.get(code);
  if (!format) return null;
  const y = Number(year);
  if (!YEARS.includes(y)) return null;

  const override = format.overrides?.[y] ?? {};
  const blueprint = { ...format.blueprint, ...override };
  const sections = (blueprint.sections ?? []).map((section) => ({
    ...section,
    requirements: section.requirements.map((r) => ({
      ...r,
      display_label: requirementLabel(r),
      types: typesFor(r),
    })),
  }));

  return {
    code: format.code,
    name: format.name,
    display_name: `${format.name} ${y}`,
    body: format.body,
    category: format.category,
    mode: format.mode,
    source_url: format.source_url,
    enforced: !!format.enforced,
    year: y,
    provisional: y > format.official_through,
    duration_minutes: blueprint.duration_minutes ?? null,
    notes: blueprint.notes ?? [],
    total_questions: blueprint.total_questions ?? null,
    sections,
    totals: computeTotals(sections, blueprint),
    subjects: Array.from(
      new Set(sections.flatMap((s) => (s.subjects?.length ? s.subjects : [s.subject])))
    ),
  };
}

/** Every (format, year) pair offered in the Admin dropdown. */
function listFormats() {
  const out = [];
  for (const format of FORMATS.values()) {
    for (const year of YEARS) {
      const resolved = resolveFormat(format.code, year);
      out.push({
        code: format.code,
        year,
        display_name: resolved.display_name,
        name: format.name,
        body: format.body,
        category: format.category,
        mode: format.mode,
        enforced: resolved.enforced,
        provisional: resolved.provisional,
        duration_minutes: resolved.duration_minutes,
        total_questions: resolved.totals.questions,
        total_marks: resolved.totals.marks,
        section_count: resolved.sections.length,
        subjects: resolved.subjects,
      });
    }
  }
  return out.sort(
    (a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name) || a.year - b.year
  );
}

/* -------------------------------- validating ------------------------------- */

/**
 * Check a set of questions against a resolved blueprint.
 *
 * `questions` items need { id, section_name, question_type, marks }.
 * Requirements are matched greedily on (type, marks) so a section can hold
 * several marks-tiers of the same type (GATE) without double-counting.
 *
 * Returns a report the UI renders directly:
 *   { enforced, ok, sections: [...], totals, errors, warnings }
 */
function validateComposition(resolved, questions) {
  const list = Array.isArray(questions) ? questions : [];

  // Fail CLOSED. An exam with no enforceable blueprint used to accept any
  // number of questions, which is exactly how an over-length paper reaches
  // the preview. There is no such thing as "no limit" any more: either the
  // reference pins the counts down, or the Admin supplied them at exam
  // creation, or the paper cannot be composed at all.
  if (!resolved || !resolved.enforced) {
    return {
      enforced: false,
      ok: false,
      sections: [],
      totals: {
        current: list.length,
        required: null,
        marks_current: sumMarks(list),
        marks_required: null,
      },
      errors: [
        resolved
          ? `${resolved.display_name} has no question-count blueprint, so the paper cannot be validated. The Admin must set the questions per section for this exam.`
          : 'This exam has no examination format attached, so question counts cannot be enforced. The Admin must attach a format before a paper can be composed.',
      ],
      warnings: [],
    };
  }

  const errors = [];
  const warnings = [];
  const unassigned = list.filter(
    (q) => !resolved.sections.some((s) => s.name === (q.section_name || ''))
  );
  for (const q of unassigned) {
    errors.push(
      `A question is tagged with section "${q.section_name || '(none)'}", which does not exist in ${resolved.display_name}.`
    );
  }

  const sections = resolved.sections.map((section) => {
    const pool = list.filter((q) => (q.section_name || '') === section.name);
    const claimed = new Set();

    const requirements = section.requirements.map((r) => {
      const types = r.types ?? typesFor(r);
      const matches = pool.filter(
        (q) =>
          !claimed.has(q.id) &&
          types.includes(q.question_type) &&
          Number(q.marks) === Number(r.marks_correct)
      );
      for (const q of matches) claimed.add(q.id);
      const current = matches.length;
      const status = current === 0 && r.min > 0 ? 'empty' : current < r.min ? 'short' : current > r.max ? 'over' : 'ok';
      if (status === 'over') {
        errors.push(
          `${section.name}: ${requirementLabel(r)} — the format allows at most ${r.max}, but ${current} are attached.`
        );
      } else if (status !== 'ok') {
        errors.push(
          `${section.name} requires ${requirementLabel(r)} at ${r.marks_correct} mark${r.marks_correct === 1 ? '' : 's'} each. You currently have ${current}.`
        );
      }
      return {
        label: requirementLabel(r),
        types,
        count: r.count,
        min: r.min,
        max: r.max,
        current,
        status,
        marks_correct: r.marks_correct,
        negative_marks: r.negative_marks,
        unattempted_marks: r.unattempted_marks ?? 0,
      };
    });

    const strays = pool.filter((q) => !claimed.has(q.id));
    for (const q of strays) {
      errors.push(
        `${section.name}: a ${TYPE_LABEL[q.question_type] ?? q.question_type} worth ${q.marks} mark(s) does not fit any quota this section defines.`
      );
    }

    const requiredMin = requirements.reduce((n, r) => n + r.min, 0);
    const requiredMax = requirements.reduce((n, r) => n + r.max, 0);
    const current = pool.length;
    return {
      name: section.name,
      subject: section.subject,
      subjects: section.subjects ?? [section.subject],
      requirements,
      current,
      required_min: requiredMin,
      required_max: requiredMax,
      /** Fixed requirement when min === max, else null (ranged sections). */
      required: requiredMin === requiredMax ? requiredMin : null,
      marks: sumMarks(pool),
      complete: requirements.every((r) => r.status === 'ok') && strays.length === 0,
      over: current > requiredMax,
    };
  });

  const totalCurrent = list.length;
  const fixedTotal = resolved.total_questions ?? resolved.totals.questions;
  if (fixedTotal != null && totalCurrent !== fixedTotal) {
    errors.push(`${resolved.display_name} is a ${fixedTotal}-question paper. You currently have ${totalCurrent}.`);
  }
  if (resolved.provisional) {
    warnings.push(
      `The ${resolved.year} pattern is carried forward from ${resolved.year - 1} and is not yet confirmed by an official notification.`
    );
  }

  return {
    enforced: true,
    ok: errors.length === 0 && sections.every((s) => s.complete),
    sections,
    totals: {
      current: totalCurrent,
      required: fixedTotal,
      required_min: resolved.totals.questions_min,
      required_max: resolved.totals.questions_max,
      marks_current: sumMarks(list),
      marks_required: resolved.totals.marks,
    },
    errors,
    warnings,
  };
}

function sumMarks(questions) {
  return round2(questions.reduce((n, q) => n + (Number(q.marks) || 0), 0));
}

/**
 * Alignment check for a question entering the bank.
 *
 * The bank is deliberately UNLIMITED — a setter may store 500 Physics
 * questions for a 25-question paper. What is checked here is only that the
 * question could ever be used: it names a real section of the format, and its
 * type and marks match one of that section's quotas. The count limit belongs
 * to the paper, not the bank (see validateComposition).
 *
 * Returns null when the question is allowed, or a reason string.
 */
function checkQuestionSlot(resolved, candidate) {
  if (!resolved || !resolved.enforced) return null;
  const section = resolved.sections.find((s) => s.name === candidate.section_name);
  if (!section) {
    return `"${candidate.section_name || '(none)'}" is not a section of ${resolved.display_name}.`;
  }
  const fits = section.requirements.some(
    (r) =>
      (r.types ?? typesFor(r)).includes(candidate.question_type) &&
      Number(r.marks_correct) === Number(candidate.marks)
  );
  if (!fits) {
    const allowed = section.requirements
      .map((r) => `${requirementLabel(r)} @ ${r.marks_correct} marks`)
      .join('; ');
    return `${section.name} accepts only: ${allowed}.`;
  }
  return null;
}

/* ------------------------------ bank ceiling ------------------------------- */

/**
 * How many times over the number of questions an exam actually consumes may
 * be banked for one slot.
 *
 * The bank used to be unbounded, which let a 25-question section accumulate
 * hundreds of plaintext questions nobody would ever draw on — waste, and leak
 * surface. Capping at exactly what is consumed would be worse: a setter who
 * rejects one weak question could not replace it until somebody withdrew
 * another. A factor of two keeps real choice while bounding the bank.
 *
 * The teacher's upload screen mirrors this constant — keep the two in step.
 */
const BANK_HEADROOM = 2;

/**
 * The bank ceiling for one (section, type, marks) slot of an exam.
 *
 * Returns null when no ceiling can be derived — an unenforced blueprint, an
 * unknown section, or a type/marks pair the section does not use. Rejecting
 * those is checkQuestionSlot's job; this function only sizes a slot that has
 * already been found to align.
 *
 * `perPaper` is the most any single paper set may take, so `perPaper x sets`
 * is what the exam consumes when every set is distinct, and the ceiling is
 * that times the headroom. Note it uses the set count even when the exam
 * allows question reuse: reuse being permitted does not mean the setter will
 * use it, and a cap that assumed reuse would block a setter who wants genuinely
 * distinct sets.
 */
function slotCeiling(resolved, candidate, setCount, headroom = BANK_HEADROOM) {
  if (!resolved || !resolved.enforced) return null;
  const section = (resolved.sections ?? []).find((s) => s.name === candidate.section_name);
  if (!section) return null;

  const perPaper = (section.requirements ?? [])
    .filter(
      (r) =>
        (r.types ?? typesFor(r)).includes(candidate.question_type) &&
        Number(r.marks_correct) === Number(candidate.marks)
    )
    .reduce((n, r) => Math.max(n, Number(r.max) || 0), 0);
  if (perPaper <= 0) return null;

  const sets = Math.max(1, Math.trunc(Number(setCount) || 1));
  const target = perPaper * sets;
  return { perPaper, sets, target, ceiling: target * headroom };
}

/* --------------------------- admin-defined counts -------------------------- */

/**
 * Turn Admin-supplied per-section counts into a real, enforceable blueprint.
 *
 * Formats whose reference explicitly defers to the yearly brochure (CAT,
 * KCET, WBJEE …) publish no question counts, and an exam without counts
 * cannot police its papers. Rather than letting those exams through
 * unchecked, the Admin states the counts once at exam creation and the
 * result is enforced exactly like a published blueprint.
 *
 * A section may carry more than one row — that is what makes a HYBRID
 * section possible (e.g. a board's "Science" section holding both an
 * MCQ/objective quota and a theoretical/subjective quota at their own marks
 * and count), the same way the built-in GATE blueprint layers a 1-mark and a
 * 2-mark tier inside one section. Two rows for the same section must still
 * differ in (type, marks) — the same quota given twice is just a mistake.
 *
 * `rows`: [{ name, subject?, question_type?, count, marks_correct, negative_marks? }]
 * Returns { blueprint } or { error }.
 */
function buildCustomBlueprint(resolved, rows) {
  if (!resolved) return { error: 'Unknown exam format' };
  if (!Array.isArray(rows) || rows.length === 0) {
    return { error: 'Give at least one section a question count' };
  }

  const order = [];
  const byName = new Map();
  for (const [i, row] of rows.entries()) {
    const name = String(row?.name ?? '').trim();
    if (!name) return { error: `Row ${i + 1} needs a section name` };

    const count = Math.trunc(Number(row?.count));
    if (!Number.isFinite(count) || count < 1 || count > 1000) {
      return { error: `${name}: question count must be between 1 and 1000` };
    }
    const marks = Number(row?.marks_correct);
    if (!Number.isFinite(marks) || marks <= 0) {
      return { error: `${name}: marks per correct answer must be greater than 0` };
    }
    const negative = Number(row?.negative_marks ?? 0);
    if (!Number.isFinite(negative) || negative < 0) {
      return { error: `${name}: negative marking cannot be less than 0` };
    }
    const type = QUESTION_TYPES.includes(row?.question_type) ? row.question_type : 'mcq';

    const requirement = {
      question_type: type,
      types: [type],
      count,
      min: count,
      max: count,
      marks_correct: marks,
      negative_marks: negative,
      unattempted_marks: 0,
    };
    requirement.display_label = requirementLabel(requirement);

    if (!byName.has(name)) {
      byName.set(name, { name, subject: String(row?.subject ?? name).trim() || name, requirements: [] });
      order.push(name);
    }
    const section = byName.get(name);
    const clash = section.requirements.find(
      (r) => r.question_type === type && Number(r.marks_correct) === marks
    );
    if (clash) {
      return {
        error: `${name}: ${TYPE_LABEL[type] ?? type} at ${marks} marks is listed more than once — combine those rows into one`,
      };
    }
    section.requirements.push(requirement);
  }

  const sections = order.map((name) => byName.get(name));

  const blueprint = {
    ...resolved,
    enforced: true,
    /** Marks the blueprint as Admin-authored rather than from the catalogue. */
    custom: true,
    sections,
    totals: computeTotals(sections, {}),
    subjects: Array.from(new Set(sections.map((s) => s.subject))),
    notes: [
      ...(resolved.notes ?? []),
      'Question counts for this exam were set by the Admin because the reference does not publish them.',
    ],
  };
  blueprint.total_questions = blueprint.totals.questions;
  return { blueprint };
}

/* -------------------------------- paper sets ------------------------------- */

/** Highest number of sets an exam may have — 'Set A' … 'Set Z'. */
const MAX_PAPER_SETS = 26;

/** ['Set A', 'Set B', …] for the Admin-chosen set count. */
function setLabels(count) {
  const n = Math.max(1, Math.min(MAX_PAPER_SETS, Math.trunc(Number(count) || 1)));
  return Array.from({ length: n }, (_, i) => `Set ${String.fromCharCode(65 + i)}`);
}

/* ------------------------------- paper view -------------------------------- */

/** The requirement inside `section` that a question of this (type, marks) fills. */
function requirementFor(section, question) {
  return (
    section.requirements.find(
      (r) =>
        (r.types ?? typesFor(r)).includes(question.question_type) &&
        Number(r.marks_correct) === Number(question.marks)
    ) ?? null
  );
}

/**
 * Sub-section heading, mirroring how real papers label them:
 * "Section A — MCQ" / "Section B — Numerical Value" when a subject carries
 * more than one quota, and just the type when it carries one.
 */
function groupLabel(section, requirement, index) {
  const typeLabel =
    requirement.label ??
    (requirement.types ?? typesFor(requirement)).map((t) => TYPE_LABEL[t] ?? t).join(' / ');
  if (section.requirements.length <= 1) return typeLabel;
  return `Section ${String.fromCharCode(65 + index)} — ${typeLabel}`;
}

/** Standing instructions printed on every paper, plus the format's own notes. */
function buildInstructions(resolved, view) {
  const lines = [
    'Do not open this booklet until you are instructed to do so.',
    `This paper contains ${view.total_questions} question${view.total_questions === 1 ? '' : 's'} carrying ${view.total_marks} mark${view.total_marks === 1 ? '' : 's'} in total.`,
  ];
  if (view.duration_minutes) {
    lines.push(`Time allowed: ${view.duration_minutes} minutes.`);
  }
  if (view.sections.length > 1) {
    lines.push(
      `The paper has ${view.sections.length} sections: ${view.sections.map((s) => s.name).join(', ')}. Attempt all sections.`
    );
  }
  const marking = new Set();
  for (const section of view.sections) {
    for (const rule of section.marking) {
      marking.add(
        rule.negative_marks > 0
          ? `${rule.label}: +${rule.marks_correct} for a correct answer, −${round2(rule.negative_marks)} for an incorrect answer, ${rule.unattempted_marks} if unattempted.`
          : `${rule.label}: +${rule.marks_correct} for a correct answer, no negative marking, ${rule.unattempted_marks} if unattempted.`
      );
    }
  }
  lines.push(...marking);
  lines.push(
    'This copy is uniquely watermarked and QR-signed; its chain of custody is tracked and any leak is traceable to this copy.'
  );
  if (resolved?.notes?.length) lines.push(...resolved.notes);
  return lines;
}

/**
 * Render a paper exactly as it will be printed.
 *
 * Shape follows a real Indian question paper: a subject-level section
 * ("PHYSICS"), split into typed sub-sections ("Section A — MCQ",
 * "Section B — Numerical Value"), with question numbering running
 * continuously across the whole paper.
 *
 * This is what the setter previews, what gets sealed inside the ciphertext,
 * and what is printed — one builder, so the three can never drift apart.
 */
function buildPaperView({ paper, exam, resolved, questions }) {
  const rows = [...(questions ?? [])].sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
  const enforced = !!(resolved && resolved.enforced);

  const buckets = enforced
    ? resolved.sections.map((section) => ({
        section,
        rows: rows.filter((q) => (q.section_name || '') === section.name),
      }))
    : [{ section: null, rows }];

  // Anything the blueprint does not account for still gets printed rather
  // than silently dropped — validation is what stops it reaching this point.
  const placed = new Set(buckets.flatMap((b) => b.rows.map((r) => r.id)));
  const leftovers = rows.filter((r) => !placed.has(r.id));
  if (leftovers.length) buckets.push({ section: null, rows: leftovers });

  let number = 0;
  const shape = (q, requirement) => {
    number += 1;
    const negative = requirement ? negativeFor(requirement, q.question_type) : 0;
    return {
      number,
      id: q.id,
      question_type: q.question_type,
      body: q.body,
      options: Array.isArray(q.options) ? q.options : [],
      marks: Number(q.marks) || 0,
      negative_marks: round2(negative),
      unattempted_marks: requirement ? (requirement.unattempted_marks ?? 0) : 0,
      subject: q.subject ?? null,
      topic: q.topic ?? null,
    };
  };

  const sections = buckets
    .filter((b) => b.rows.length > 0 || b.section)
    .map((bucket) => {
      const marking = new Map();
      const noteMarking = (label, marksCorrect, negative, unattempted) => {
        if (!marking.has(label)) {
          marking.set(label, {
            label,
            marks_correct: Number(marksCorrect),
            negative_marks: round2(negative),
            unattempted_marks: unattempted,
          });
        }
      };

      let groups;
      if (bucket.section) {
        const claimed = new Set();
        groups = bucket.section.requirements.map((requirement, i) => {
          const types = requirement.types ?? typesFor(requirement);
          const mine = bucket.rows.filter(
            (q) =>
              !claimed.has(q.id) &&
              types.includes(q.question_type) &&
              Number(q.marks) === Number(requirement.marks_correct)
          );
          for (const q of mine) claimed.add(q.id);
          const label = groupLabel(bucket.section, requirement, i);
          noteMarking(
            label,
            requirement.marks_correct,
            negativeFor(requirement, types[0]),
            requirement.unattempted_marks ?? 0
          );
          return {
            label,
            required: requirement.count,
            required_min: requirement.min,
            required_max: requirement.max,
            types,
            marks_correct: requirement.marks_correct,
            negative_marks: round2(negativeFor(requirement, types[0])),
            unattempted_marks: requirement.unattempted_marks ?? 0,
            questions: mine.map((q) => shape(q, requirement)),
          };
        });
        // Questions the blueprint cannot place still appear, at the end.
        const strays = bucket.rows.filter((q) => !claimed.has(q.id));
        if (strays.length) {
          groups.push({
            label: 'Additional questions',
            required: null,
            required_min: 0,
            required_max: strays.length,
            types: [],
            marks_correct: null,
            negative_marks: 0,
            unattempted_marks: 0,
            questions: strays.map((q) => shape(q, null)),
          });
        }
      } else {
        groups = [
          {
            label: 'Questions',
            required: null,
            required_min: 0,
            required_max: bucket.rows.length,
            types: [],
            marks_correct: null,
            negative_marks: 0,
            unattempted_marks: 0,
            questions: bucket.rows.map((q) => shape(q, null)),
          },
        ];
      }

      const all = groups.flatMap((g) => g.questions);
      return {
        name: bucket.section?.name ?? paper.subject ?? 'Questions',
        subject: bucket.section?.subject ?? paper.subject ?? null,
        groups,
        questions: all,
        question_count: all.length,
        marks: round2(all.reduce((n, q) => n + q.marks, 0)),
        marking: Array.from(marking.values()),
      };
    });

  const view = {
    paper_id: paper.id,
    title: paper.title,
    subject: paper.subject,
    status: paper.status,
    set_label: paper.set_label ?? null,
    exam_name: exam?.name ?? null,
    exam_date: exam?.exam_date ?? null,
    format_code: resolved?.code ?? null,
    format_name: resolved?.name ?? null,
    format_year: resolved?.year ?? null,
    format_display_name: resolved?.display_name ?? null,
    paper_label: resolved?.name ?? paper.subject ?? null,
    provisional: !!resolved?.provisional,
    enforced,
    duration_minutes: resolved?.duration_minutes ?? exam?.duration_min ?? null,
    sections,
    total_questions: sections.reduce((n, s) => n + s.question_count, 0),
    total_marks: round2(sections.reduce((n, s) => n + s.marks, 0)),
  };
  view.instructions = buildInstructions(resolved, view);
  return view;
}

module.exports = {
  YEARS,
  QUESTION_TYPES,
  TYPE_LABEL,
  MAX_PAPER_SETS,
  setLabels,
  buildCustomBlueprint,
  listFormats,
  resolveFormat,
  validateComposition,
  checkQuestionSlot,
  BANK_HEADROOM,
  slotCeiling,
  buildPaperView,
  negativeFor,
  requirementLabel,
};
