# Strom — Setup EC2 (acesso externo)

## Hostname público desta instância

```
ec2-35-180-182-240.eu-west-3.compute.amazonaws.com
IP público: 35.180.182.240
Região:     eu-west-3
```

## Configuração aplicada

Adicionado ao `/opt/strom/app/.env.local`:

```env
# Public host gating — substring match against the Host header.
# Requests whose Host contains any of these strings hide /admin and gated APIs.
# Local access (localhost / 127.0.0.1 / private IP) keeps full admin access.
PUBLIC_HOSTS=amazonaws.com
```

Usei `amazonaws.com` (substring) em vez do hostname completo para:

- não prender a configuração ao IP público atual (que pode mudar em reboot);
- cobrir automaticamente qualquer outra instância EC2.

## Como o gate funciona

Implementado em `src/lib/public-host.ts`. Faz substring-match (case-insensitive) do header `Host` contra a lista de `PUBLIC_HOSTS`.

Usado em:

- `src/app/layout.tsx` — passa `isPublic` para o `ProjectProvider`, escondendo UI admin no cliente.
- `src/app/admin/layout.tsx` — qualquer `GET /admin/*` vindo de host público faz `redirect('/')`.
- `src/app/api/impact/route.ts` — API gated por host público.

## Reverse proxy (nginx) — porta 80, sem `:3333` na URL

Já configurado em `/etc/nginx/sites-enabled/strom`: nginx escuta na 80 e faz proxy pra `127.0.0.1:3333` preservando o header `Host`, então o gate de `PUBLIC_HOSTS` continua funcionando.

```nginx
server {
    listen 80 default_server;
    listen [::]:80 default_server;
    server_name _;
    client_max_body_size 100M;

    location / {
        proxy_pass http://127.0.0.1:3333;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 300s;
    }
}
```

Security Group aberto: **22** (SSH), **80** (HTTP), **443** (HTTPS — pronto pra TLS), 8443 (NICE DCV). A porta **3333 não precisa estar aberta** — só responde em localhost.

## Validação (testado)

| Acesso                                                          | `/admin`                |
| --------------------------------------------------------------- | ----------------------- |
| `http://localhost:3333/admin` (no próprio servidor)             | **200** — admin liberado |
| `http://localhost/admin` (via nginx, host local)                | **200** — admin liberado |
| `http://ec2-35-180-182-240.eu-west-3.compute.amazonaws.com/admin` (externo, sem porta) | **307 → /** — escondido |

## Acesso de fora

URL pública: `http://ec2-35-180-182-240.eu-west-3.compute.amazonaws.com` — sem porta, sem `:3333`.

Para HTTPS, basta instalar um cert na 443 (ex.: `certbot --nginx`); o vhost já está pronto pra receber TLS. O gate continua funcionando porque ele lê só o `Host`.

## Subir o app

```bash
cd /opt/strom/app
./start.sh
```

Defaults: porta 3333, scheduler de auto-discovery ligado, warmup das rotas em background.

Variáveis úteis:

- `PORT=8080 ./start.sh` — muda a porta
- `STROM_AUTO_DISCOVERY=0 ./start.sh` — desliga o scheduler
- `STROM_WARMUP=0 ./start.sh` — desliga o pré-compile das rotas
- `STROM_TURBO=1 ./start.sh` — habilita Turbopack (experimental)

## Status do projeto (verificado)

- Server sobe em ~19s, todas as rotas principais retornam 200.
- `tsc --noEmit` passa sem erros.
- Único warning (benigno): `pdf-parse` — require dinâmico interno do pacote. Não afeta runtime.
