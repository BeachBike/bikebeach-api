/// Canonical PAR-Q question set + risk flags — the SERVER-side source of
/// truth for "does this PAR-Q indicate an active health concern". Mirrors the
/// frontend `web/src/components/saude/parq-questions.ts` (keys must match).
///
/// The stored `answers` JSON (see HealthGateService.submitParq) has the shape
/// `{ responses: { [key]: 'sim' | 'nao' }, notes: string }` — the frontend's
/// `ParqAnswers`. A question is "flagged" when its answer equals its `risk`
/// value (all current questions flag on `sim`).

export interface ParqQuestion {
  key: string;
  label: string;
  risk: 'sim' | 'nao';
}

export const PARQ_QUESTIONS: ReadonlyArray<ParqQuestion> = [
  {
    key: 'cardiac',
    label:
      'Algum médico já te disse que você tem problema de coração e que só deveria fazer atividade física com supervisão?',
    risk: 'sim',
  },
  {
    key: 'chestPainExercise',
    label: 'Você sente dor no peito quando faz atividade física?',
    risk: 'sim',
  },
  {
    key: 'chestPainRest',
    label:
      'No último mês, você teve dor no peito sem estar fazendo atividade física?',
    risk: 'sim',
  },
  {
    key: 'dizziness',
    label:
      'Você tem perda de equilíbrio por tontura ou já perdeu a consciência fazendo atividade física?',
    risk: 'sim',
  },
  {
    key: 'jointBone',
    label:
      'Você tem algum problema ósseo ou articular que pode piorar com atividade física?',
    risk: 'sim',
  },
  {
    key: 'medication',
    label: 'Você toma remédio para pressão alta ou problema de coração?',
    risk: 'sim',
  },
  {
    key: 'otherReason',
    label:
      'Existe alguma outra razão pela qual você não deveria fazer atividade física?',
    risk: 'sim',
  },
] as const;

/// Reads the `responses` map out of a stored `answers` blob, tolerating
/// malformed / legacy shapes (returns an empty map).
function responsesOf(answers: unknown): Record<string, unknown> {
  if (answers && typeof answers === 'object') {
    const r = (answers as { responses?: unknown }).responses;
    if (r && typeof r === 'object') return r as Record<string, unknown>;
  }
  return {};
}

/// Keys of the questions the user answered with their risk value.
export function parqFlaggedKeys(answers: unknown): string[] {
  const responses = responsesOf(answers);
  return PARQ_QUESTIONS.filter((q) => responses[q.key] === q.risk).map(
    (q) => q.key,
  );
}

/// True when ANY question is flagged — i.e. the user reported an active
/// health concern that warrants a heads-up before exercising.
export function isParqFlagged(answers: unknown): boolean {
  return parqFlaggedKeys(answers).length > 0;
}

/// The optional free-text note the user left, if any.
export function parqNotes(answers: unknown): string | null {
  if (answers && typeof answers === 'object') {
    const n = (answers as { notes?: unknown }).notes;
    if (typeof n === 'string' && n.trim()) return n.trim();
  }
  return null;
}
