/**
 * Gera um código alfanumérico aleatório (usado para códigos de recuperação/validação).
 */
export function generateValidationCode(length = 6): string {
  const characters =
    'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let code = '';
  for (let i = 0; i < length; i++) {
    const randomIndex = Math.floor(Math.random() * characters.length);
    code += characters[randomIndex];
  }
  return code;
}

/**
 * Gera uma senha temporária alfanumérica aleatória.
 * Usada na criação de colaboradores e médicos (primeiro acesso).
 */
export function generateTemporaryPassword(length = 6): string {
  return generateValidationCode(length);
}
