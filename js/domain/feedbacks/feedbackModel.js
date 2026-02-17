/**
 * Modelo de Dados para Feedbacks de Treino
 * 
 * Estrutura do Feedback:
 * {
 *   id: string (ID do documento)
 *   studentId: string (UID do aluno)
 *   workoutId: string (ID do treino)
 *   weekIdentifier: string (identificador da semana, formato: "YYYY-WW")
 *   dayOfWeek: string (monday, tuesday, wednesday, thursday, friday, saturday, sunday)
 *   effortLevel: number (1-10)
 *   sensation: string ("leve" | "ideal" | "pesado")
 *   hasPain: boolean
 *   painLocation: string (opcional, apenas se hasPain === true)
 *   comment: string (opcional)
 *   createdAt: timestamp
 * }
 */

/**
 * Obter identificador da semana atual (formato: YYYY-WW)
 * Exemplo: "2024-15" (ano 2024, semana 15)
 */
function getCurrentWeekIdentifier() {
  const now = new Date();
  const startOfYear = new Date(now.getFullYear(), 0, 1);
  const pastDaysOfYear = (now - startOfYear) / 86400000;
  const weekNumber = Math.ceil((pastDaysOfYear + startOfYear.getDay() + 1) / 7);
  return `${now.getFullYear()}-${weekNumber}`;
}

/**
 * Obter identificador único para feedback (evita duplicatas)
 * Formato: studentId_workoutId_weekIdentifier_dayOfWeek
 */
function getFeedbackKey(studentId, workoutId, weekIdentifier, dayOfWeek) {
  return `${studentId}_${workoutId}_${weekIdentifier}_${dayOfWeek}`;
}

/**
 * Validar dados do feedback antes de salvar
 */
function validateFeedbackData(data) {
  const errors = [];

  if (!data.studentId || typeof data.studentId !== 'string') {
    errors.push('studentId é obrigatório');
  }

  if (!data.workoutId || typeof data.workoutId !== 'string') {
    errors.push('workoutId é obrigatório');
  }

  if (!data.weekIdentifier || typeof data.weekIdentifier !== 'string') {
    errors.push('weekIdentifier é obrigatório');
  }

  if (!data.dayOfWeek || !['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'].includes(data.dayOfWeek)) {
    errors.push('dayOfWeek inválido');
  }

  if (typeof data.effortLevel !== 'number' || data.effortLevel < 1 || data.effortLevel > 10) {
    errors.push('effortLevel deve ser um número entre 1 e 10');
  }

  if (!['leve', 'ideal', 'pesado'].includes(data.sensation)) {
    errors.push('sensation deve ser "leve", "ideal" ou "pesado"');
  }

  if (typeof data.hasPain !== 'boolean') {
    errors.push('hasPain deve ser boolean');
  }

  if (data.hasPain && (!data.painLocation || data.painLocation.trim() === '')) {
    errors.push('painLocation é obrigatório quando hasPain é true');
  }

  return {
    isValid: errors.length === 0,
    errors
  };
}

// Exportar funções
if (typeof window !== 'undefined') {
  window.feedbackModel = {
    getCurrentWeekIdentifier,
    getFeedbackKey,
    validateFeedbackData
  };
}

