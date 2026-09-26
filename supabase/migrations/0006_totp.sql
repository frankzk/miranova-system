-- Clave secreta de verificación en dos pasos (2FA) de la plataforma, cifrada
-- como la contraseña. Con ella el servidor genera el código de 6 dígitos al
-- iniciar sesión (Dropi la pide si la cuenta tiene 2FA activado).
alter table public.accounts add column if not exists totp_secret_enc text;
