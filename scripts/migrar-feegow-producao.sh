#!/usr/bin/env bash
#
# Carga do export Feegow do Dr. Fabio em PRODUÇÃO, rodada na VPS.
#
# Faz, em sequência: conferências → simulação (nada gravado) → confirmação →
# carga real → conferência pós-carga. Roda o importador num container
# descartável da própria imagem da API (mesmo padrão do deploy.sh com as
# migrations): ela já tem o código, as dependências e o .env de produção.
#
# Pré-requisito: o export copiado para a VPS, a partir da sua máquina:
#   rsync -avP --exclude carga-local --exclude dry-run-local \
#     ~/Documents/inexci/inexci-app/cliente-dr-fabio/ \
#     inexci-vps:feegow-import/cliente-dr-fabio/
#
# Uso, na VPS:
#   bash /opt/inexci/inexci-api/scripts/migrar-feegow-producao.sh
#
# Pode rodar de novo à vontade: o ledger.json em ~/feegow-import/carga-prod
# faz o importador pular o que já entrou (retoma de onde parou).
#
# Variáveis opcionais: OWNER_EMAIL, FEEGOW_BASE, COMPOSE_FILE,
# FEEGOW_SEM_TMUX=1 (não abre sessão tmux).

set -euo pipefail

OWNER_EMAIL="${OWNER_EMAIL:-drfabiosegall@gmail.com}"
BASE="${FEEGOW_BASE:-$HOME/feegow-import}"
EXPORT_DIR="$BASE/cliente-dr-fabio"
OUT_DIR="$BASE/carga-prod"
COMPOSE_FILE="${COMPOSE_FILE:-/opt/inexci/docker-compose.prod.yml}"
SESSAO="feegow"
SCRIPT="$(cd "$(dirname "$0")" && pwd)/$(basename "$0")"

# A carga leva vários minutos (753 fotos para o R2): dentro do tmux, uma queda
# do SSH não mata o processo. Reconectar: ssh inexci-vps && tmux attach -t feegow
if [ -z "${TMUX:-}" ] && [ -z "${FEEGOW_SEM_TMUX:-}" ] && command -v tmux >/dev/null 2>&1; then
  if tmux has-session -t "$SESSAO" 2>/dev/null; then
    echo "Já existe uma sessão '$SESSAO' em andamento. Entre nela com: tmux attach -t $SESSAO"
    exit 1
  fi
  exec tmux new-session -s "$SESSAO" \
    "bash '$SCRIPT'; echo; read -rp 'Fim. Enter para fechar a sessão tmux... ' _"
fi

falhar() {
  echo
  echo "ERRO: $*"
  exit 1
}

titulo() {
  echo
  echo "=================================================================="
  echo "  $*"
  echo "=================================================================="
}

importar() {
  # -T: sem TTY (a saída passa pelo tee). As credenciais vêm do env_file do
  # serviço api (/opt/inexci/.env); TZ=UTC já está no script import:feegow.
  # Roda com o usuário de quem chamou (não o "node" da imagem): assim o export
  # e a saída, que têm dado de paciente, ficam só com o dono (0700/0600), sem
  # abrir permissão para outros usuários da VPS.
  docker compose -f "$COMPOSE_FILE" run --rm --no-deps -T \
    --user "$(id -u):$(id -g)" -e HOME=/tmp \
    -v "$BASE:/import" api \
    yarn -s import:feegow \
    --dir /import/cliente-dr-fabio \
    --owner-email "$OWNER_EMAIL" \
    --out /import/carga-prod \
    "$@"
}

umask 077
mkdir -p "$OUT_DIR"
chmod 700 "$BASE" "$OUT_DIR"
LOG="$OUT_DIR/execucao-$(date +%Y-%m-%d_%H%M%S).log"
exec > >(tee -a "$LOG") 2>&1

titulo "Migração Feegow → INEXCI (produção) — dono: $OWNER_EMAIL"
echo "Log desta execução: $LOG"

# ── 1. Conferências ──────────────────────────────────────────────────────────
titulo "1/5 Conferências"

command -v docker >/dev/null 2>&1 || falhar "docker não encontrado."
[ -f "$COMPOSE_FILE" ] || falhar "compose não encontrado em $COMPOSE_FILE."
cd "$(dirname "$COMPOSE_FILE")"

[ -f "$EXPORT_DIR/database/Dados do Cliente/profissionais.csv" ] ||
  falhar "export não encontrado em $EXPORT_DIR. Copie da sua máquina com o rsync do cabeçalho deste script."
[ -d "$EXPORT_DIR/Client" ] || falhar "pasta Client/ (fotos e anexos) ausente em $EXPORT_DIR."
echo "✓ export encontrado ($(du -sh "$EXPORT_DIR" | cut -f1))"

STATUS_API=$(docker inspect --format='{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' inexci-api 2>/dev/null || echo "ausente")
[ "$STATUS_API" = "healthy" ] ||
  falhar "API está '$STATUS_API'. Espere o deploy terminar (API healthy) antes da carga."
echo "✓ API healthy"

docker compose -f "$COMPOSE_FILE" run --rm --no-deps -T api \
  test -f src/database/import/core/fuso.ts ||
  falhar "a imagem da API não tem o importador atualizado. O deploy da main com a migração Feegow concluiu?"
echo "✓ imagem da API com o importador atualizado"

# Dado de paciente: só o dono lê. O container roda com o mesmo uid (ver
# `importar`), então não precisa de permissão para outros.
chmod -R u=rwX,go= "$EXPORT_DIR" "$OUT_DIR"
importar_como_usuario_ok=$(docker compose -f "$COMPOSE_FILE" run --rm --no-deps -T \
  --user "$(id -u):$(id -g)" -e HOME=/tmp -v "$BASE:/import" api \
  sh -c 'test -r "/import/cliente-dr-fabio/database/Dados do Cliente/profissionais.csv" && touch /import/carga-prod/.teste-escrita && rm /import/carga-prod/.teste-escrita && node -e "require(\"ts-node\")" && echo ok' 2>/dev/null || true)
[ "$importar_como_usuario_ok" = "ok" ] ||
  falhar "o container não conseguiu ler o export / escrever em $OUT_DIR / carregar o ts-node com o uid $(id -u)."
echo "✓ container lê o export e grava a saída com o seu usuário (permissões 0700)"

if [ -f "$OUT_DIR/ledger.json" ]; then
  echo "• ledger.json já existe: esta execução RETOMA a carga anterior (o que já entrou é pulado)."
fi

# ── 2. Simulação ─────────────────────────────────────────────────────────────
titulo "2/5 Simulação contra produção (nada é gravado)"

SIMULACAO="$OUT_DIR/simulacao.txt"
importar --fase tudo --dry-run | tee "$SIMULACAO" ||
  falhar "a simulação falhou (veja a mensagem acima). Nada foi gravado."

BANCO=$(grep -m1 '\[import-feegow\] banco:' "$SIMULACAO" | sed 's/.*banco: //')
titulo "Pontos de atenção da simulação"
echo "Banco de destino: ${BANCO:-?}"
if grep -E 'dono da conta|já usado' "$SIMULACAO"; then
  echo
  echo "↑ 'já usado' = a pessoa já tem conta na INEXCI e fica de fora da equipe importada."
  echo "  Aviso sobre o 'dono da conta' NÃO deveria aparecer: se aparecer, não siga."
else
  echo "Nenhum conflito de e-mail/celular e nenhum aviso sobre o dono da conta."
fi
echo
echo "Contagens esperadas (aprox.): 2590 pacientes, 5038 consultas, 14765 atividades,"
echo "4434 fichas, 753 fotos, 28 grades, 441 bloqueios, 10 feriados."
echo "Relatórios completos: $OUT_DIR/relatorio-<fase>.json"

# ── 3. Confirmação ───────────────────────────────────────────────────────────
titulo "3/5 Confirmação"
echo "A próxima etapa GRAVA no banco '${BANCO:-?}' e envia as fotos/anexos para o R2."
read -rp "Para gravar em PRODUÇÃO, digite o e-mail do dono ($OWNER_EMAIL): " RESPOSTA
RESPOSTA=$(echo "$RESPOSTA" | tr '[:upper:]' '[:lower:]' | xargs)
[ "$RESPOSTA" = "$OWNER_EMAIL" ] || falhar "confirmação não confere. Nada foi gravado."

# ── 4. Carga real ────────────────────────────────────────────────────────────
titulo "4/5 Carga real (7 fases: cadastro → disponibilidade)"
# --sim: a confirmação já foi feita acima, uma vez só para as 7 fases.
if ! importar --fase tudo --sim; then
  echo
  echo "A carga parou numa fase. Ela foi desfeita; as anteriores ficaram gravadas"
  echo "e estão no ledger. Corrija a causa (mensagem acima) e rode este script"
  echo "de novo: ele retoma de onde parou, sem duplicar."
  exit 2
fi

# ── 5. Conferência ───────────────────────────────────────────────────────────
titulo "5/5 Conferência pós-carga (ledger × banco)"
set +e
importar --verificar
VERIFICACAO=$?
set -e

titulo "Resultado"
if [ "$VERIFICACAO" -eq 0 ]; then
  echo "✓ Carga concluída e conferida: tudo o que o ledger registrou está no banco."
else
  echo "⚠ A conferência encontrou diferença (código $VERIFICACAO). Veja a tabela acima"
  echo "  e o log $LOG antes de liberar o acesso ao cliente."
  exit 2
fi

cat <<EOF

Próximos passos (na tela, logado como $OWNER_EMAIL):
  1. Colaboradores: preencher a UF (e o número, quando faltar) do registro de
     cada profissional — sem isso ninguém emite receita/atestado.
  2. Liberar o acesso dos colaboradores importados que vão usar (entram pendentes).
  3. Modelo de atestado: trocar "a contar de {{data}}" por "a contar de {{inicio}}".
  4. Recriar o bloqueio semanal de segunda, 12:00–12:30.
  5. Conferir por amostragem: agenda, pacientes com foto, fichas e anexos.
  6. Desligar os lembretes do Feegow (a INEXCI passa a lembrar as consultas futuras).

Depois, NA SUA MÁQUINA, traga o ledger, os relatórios e os logs:
  rsync -avP inexci-vps:feegow-import/carga-prod/ ~/inexci-carga-prod-$(date +%F)/

E então, NA VPS, apague o export (tem dados de pacientes):
  rm -rf $BASE
EOF
