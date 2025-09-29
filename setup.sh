#!/bin/bash

set -e

if [ -s "$NVM_DIR/nvm.sh" ]; then
    . "$NVM_DIR/nvm.sh"
else
    echo "Erro: O NVM não foi encontrado em $NVM_DIR"
    exit 1
fi

if ! node -v &> /dev/null
then
    echo "Erro: O Node.js não está instalado."
    echo "Por favor, instale o Node.js. Você pode usar o NVM para instalá-lo."
    exit 1
fi

if ! npm -v &> /dev/null
then
    echo "Erro: O npm não está instalado."
    echo "Por favor, instale o npm. Você pode instalá-lo via NVM após instalar o Node.js."
    exit 1
fi

if ! pm2 -v &> /dev/null
then
    echo "Erro: O pm2 não está instalado."
    echo "Por favor, instale o pm2 globalmente usando: npm install -g pm2"
    exit 1
fi

if [ -z "$1" ] || [ -z "$2" ] || [ -z "$3" ]; then
    echo "Uso: ./setup.sh <CLICKUP_WORKSPACE_ID> <CLICKUP_CHANNEL_ID> <CLICKUP_WEBHOOK_URL>"
    exit 1
fi

export CLICKUP_WORKSPACE_ID=$1
export CLICKUP_CHANNEL_ID=$2
export CLICKUP_WEBHOOK_URL=$3

echo "Variáveis de ambiente configuradas:"
echo "CLICKUP_WORKSPACE_ID=$CLICKUP_WORKSPACE_ID"
echo "CLICKUP_CHANNEL_ID=$CLICKUP_CHANNEL_ID"
echo "CLICKUP_WEBHOOK_URL=$CLICKUP_WEBHOOK_URL"

DEFAULT_NODE=$(nvm alias default | awk '{print $3}')

echo "Iniciando o monitoramento dos processos..."
nvm use 20
node main.js

if [ -n "$DEFAULT_NODE" ]; then
    echo "Voltando para versão padrão ($DEFAULT_NODE)..."
    nvm use "$DEFAULT_NODE"
else
    echo "Nenhuma versão padrão definida para voltar."
fi