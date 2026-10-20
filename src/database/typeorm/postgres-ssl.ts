type EnvLike = Record<string, string | undefined>;

export interface PostgresSslOptions {
  rejectUnauthorized: boolean;
  ca?: string;
}

const PEM_MARKER = '-----BEGIN CERTIFICATE-----';

function isTrue(value: string | undefined): boolean {
  return (value ?? '').trim().toLowerCase() === 'true';
}

function isFalse(value: string | undefined): boolean {
  return (value ?? '').trim().toLowerCase() === 'false';
}

export function decodePostgresCa(raw: string | undefined): string | undefined {
  const value = (raw ?? '').trim();
  if (!value) return undefined;

  if (value.includes(PEM_MARKER)) {
    return value.replace(/\\n/g, '\n');
  }

  const decoded = Buffer.from(value, 'base64').toString('utf8');
  if (!decoded.includes(PEM_MARKER)) {
    throw new Error(
      'DB_SSL_CA inválido: informe o certificado em PEM ou em base64 do PEM.',
    );
  }
  return decoded;
}

export function resolvePostgresSsl(
  env: EnvLike = process.env,
): PostgresSslOptions | false {
  if (!isTrue(env.DB_SSL)) return false;

  const ssl: PostgresSslOptions = {
    rejectUnauthorized: !isFalse(env.DB_SSL_REJECT_UNAUTHORIZED),
  };

  const ca = decodePostgresCa(env.DB_SSL_CA);
  if (ca) ssl.ca = ca;

  return ssl;
}
