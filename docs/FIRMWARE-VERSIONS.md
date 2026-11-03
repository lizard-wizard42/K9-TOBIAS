# Versões independentes de firmware

O painel exibe a versão enviada por cada placa em **Seu robô**. As versões são definidas em `k9v2-1_firmware/src/firmware_version.h`; `firmwareVersion` identifica as pernas e `camFirmwareVersion` identifica a câmera no painel.

Verificação em 02/11/2026 (America/Sao_Paulo):

| Placa | Versão instalada | Validação |
| --- | --- | --- |
| Pernas ESP32 DevKit | 1.7.0 | OTA pelo IP direto concluída; /status e telemetria do hub confirmaram 1.7.0, atividade 0 e quatro ângulos comandados em 0°. Novas animações não foram acionadas fisicamente na validação. |
| ESP32-CAM | 1.0.14, revisão 14 | OTA pela rede concluída, reinício confirmado, `/status` com câmera pronta e captura HTTP 200 com JPEG válido. |

A versão 1.0.14 da câmera é enviada tanto em `/status` quanto na telemetria. O canal usado pelo painel foi verificado com `camFirmwareVersion: 1.0.14` e câmera online. O texto fixo `r12 · registrada` foi removido: sem versão recebida, o painel mostra **Não informado**.

O suporte OTA da ESP32-CAM foi confirmado por gravação real com `./ota.sh cam`. A atualização da câmera é independente da placa das pernas. Credenciais continuam no arquivo local ignorado `src/secrets.h`.

O estado de centro é uma confirmação pontual dos comandos enviados; os servos não fornecem leitura de posição mecânica. Comandos de movimento podem sair desse modo. O número MK3 identifica a marcha/modelo, não a versão de firmware.

## Acesso físico indisponível
Em 02/11/2026, o usuário informou que não consegue mais conectar a placa por cabo. Esse impedimento deve ser considerado em futuras atualizações OTA: preservar a configuração de rede, partições e mecanismo OTA existentes; compilar e validar antes do envio, e confirmar versão e comunicação após reinício. A versão 1.7.0 foi instalada sem alterações nesses componentes. A primeira tentativa via nome não concluiu; a tentativa pelo IP direto retornou sucesso e versão confirmada. Nenhum novo OTA foi feito após o aviso do usuário.
