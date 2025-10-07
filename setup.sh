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

if [ -z "$1" ] || [ -z "$2" ] || [ -z "$3" ] || [ -z "$4" ]; then
    echo "Uso: ./setup.sh <EC2_INSTANCE_NAME> <CLICKUP_API_KEY> <CLICKUP_WORKSPACE_ID> <CLICKUP_CHANNEL_ID>"
    exit 1
fi

export EC2_INSTANCE_NAME=$1
export CLICKUP_API_KEY=$2
export CLICKUP_WORKSPACE_ID=$3
export CLICKUP_CHANNEL_ID=$4

echo "Variáveis de ambiente configuradas:"
echo "EC2_INSTANCE_NAME=$EC2_INSTANCE_NAME"
echo "CLICKUP_API_KEY=$CLICKUP_API_KEY"
echo "CLICKUP_WORKSPACE_ID=$CLICKUP_WORKSPACE_ID"
echo "CLICKUP_CHANNEL_ID=$CLICKUP_CHANNEL_ID"

DEFAULT_NODE=$(nvm alias default | awk '{print $3}')

nvm use 20

echo "Instalando dependências em .api/apis/clickup..."
CURRENT_DIR=$(pwd)

cd .api/apis/clickup
npm install

cd "$CURRENT_DIR"

echo "Iniciando o monitoramento dos processos..."
node main.js

if [ -n "$DEFAULT_NODE" ]; then
    echo "Voltando para versão padrão ($DEFAULT_NODE)..."
    nvm use "$DEFAULT_NODE"
else
    echo "Nenhuma versão padrão definida para voltar."
fi