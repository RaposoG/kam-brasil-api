#!/bin/sh
# Gera o .ini do servidor a partir do ambiente e sobe o processo.
#
# O arquivo é escrito a cada boot em vez de vir na imagem: assim mudar o nome do
# servidor ou o intervalo de anúncio é editar a env no Dokploy e reiniciar, sem
# rebuildar nada. O servidor lê o .ini de ExeDir na partida e não o relê depois.
set -eu

: "${SERVER_NAME:=Kam Brasil}"
: "${SERVER_PORT:=56789}"
: "${MAX_ROOMS:=16}"
: "${WELCOME_MESSAGE:=}"
: "${ANNOUNCE_INTERVAL:=180}"

# O jogo e o servidor falam HTTP puro: não há uma linha de SSL no cliente HTTP
# do Pascal. Aqui isso não custa nada — a API está no mesmo namespace de rede,
# então o tráfego nem sai da máquina.
: "${MASTER_SERVER_URL:=http://127.0.0.1:3000/}"
: "${AUTH_VERIFY_URL:=http://127.0.0.1:3000/auth/verify}"
: "${REQUIRE_AUTH:=1}"

# Salas ranqueadas, ligadas por padrão. A API responde lista vazia quando não há
# nada pareado, então perguntar não custa nada nem polui log.
: "${RANKED_URL:=http://127.0.0.1:3000/internal/ranked}"
: "${RANKED_SECRET:=}"
: "${RANKED_SECRET_FILE:=}"

# O segredo não vem da env: a API o sorteia na primeira subida e grava no
# arquivo do volume compartilhado. Lemos o mesmo arquivo, e é assim que os dois
# lados combinam sem ninguém configurar nada.
#
# Chegamos sempre depois: o compose só sobe este container com a API saudável,
# e a API grava o arquivo antes de abrir a porta.
if [ -z "${RANKED_SECRET}" ] && [ -n "${RANKED_SECRET_FILE}" ] && [ -r "${RANKED_SECRET_FILE}" ]; then
  # tr -d '\r\n', e nao so '\n': um \r sobrando entra no sha256 e todo
  # /internal/ranked/* passa a responder 403 sem dizer por que, em silencio.
  RANKED_SECRET="$(tr -d '\r\n' < "${RANKED_SECRET_FILE}")"
fi

if [ -z "${RANKED_SECRET}" ]; then
  # Metade preenchida é o pior dos mundos: o servidor perguntaria a cada 3s e
  # levaria 403 sempre. Sem segredo, nem pergunta.
  echo "kam-brasil: sem segredo de ranqueada, salas ranqueadas desligadas neste servidor"
  RANKED_URL=""
fi

cat > "/app/KaM Remake Server Settings.ini" <<INI
[Server]
ServerName=${SERVER_NAME}
ServerPort=${SERVER_PORT}
MaxRooms=${MAX_ROOMS}
WelcomeMessage=${WELCOME_MESSAGE}

MasterServerAddressNew=${MASTER_SERVER_URL}
MasterServerAnnounceInterval=${ANNOUNCE_INTERVAL}
AnnounceDedicatedServer=1

; Temos master server próprio. A descoberta UDP só duplicaria este servidor na
; lista de quem estiver na mesma rede local.
UDPAnnounce=0

; Sem isto qualquer cliente entra com o nickname que quiser.
KamBrasilRequireAuth=${REQUIRE_AUTH}
KamBrasilAuthVerifyUrl=${AUTH_VERIFY_URL}

; Base das rotas internas de ranqueada (o servidor acrescenta /rooms, /started
; e /report). Vazio = servidor comum, sem reservas.
KamBrasilRankedUrl=${RANKED_URL}
KamBrasilRankedSecret=${RANKED_SECRET}
INI

echo "kam-brasil: servidor \"${SERVER_NAME}\" na porta ${SERVER_PORT}, anunciando em ${MASTER_SERVER_URL}"

exec /app/KaM_DedicatedServer "$@"
