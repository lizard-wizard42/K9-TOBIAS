# Painel e personalidade — firmware 1.7.0

## Onde encontrar
- **Controle:** câmera e condução; **Tela cheia** abre o painel completo.
- **Personalidade:** emoções em destaque e câmera compacta. Mudar a visualização não movimenta o robô.
- **Favoritos:** até seis comandos, escolhidos e guardados neste navegador.
- **Configurações:** Controles (inclui nome/voz), Áudio, Câmera, Manutenção e Conexão.
- **Atividade:** estado da animação enviado pela placa; é o movimento comandado, não uma medição da posição física dos servos. **Interromper** congela a posição comandada e para o som; **Padrão** volta ao centro.
- **Guardar foi removido**, inclusive o comando no hub/firmware.

## Animações e emoções
**Animações:** Acordar (inclina frente/traseira e sacode), Dormir (deita e respira lentamente), Alongar, Coçar e Dançar.
Acordar, Dormir e Alongar são silenciosos. Dançar toca a seleção musical existente.

**Emoções:** Curioso (inclina e assobia), Bravo (baixa a frente e pulsa com som grave), Vergonha (abaixa e desvia), Comemorar (balança com fanfarra), Cumprimentar (pata e olá), Robô com defeito (pequenos movimentos interrompidos, pausa e retorno).
Feliz, Triste, Confuso e Risada permanecem disponíveis.

Som e movimento das novas emoções compartilham o relógio da placa. Volume e mudo continuam valendo.
Comemorar também dá quatro piscadas curtas de 30% na lanterna da câmera, se ela estiver conectada, apagada e sem strobo. O hub agenda esse efeito; não possui sincronismo rígido com o ESP32. Um comando manual de luz toma prioridade e cancela o efeito.

### Coçada elevada e sincronizada
A traseira esquerda sobe a **80°** e coça entre **68° e 80°**. As outras patas mantêm a pose sentada.
São três rajadas de oito passadas, com pausas. O som de raspagem usa as mesmas durações dos quadros de movimento, apenas na passada de volta, e silencia nas pausas. A saída continua pela levantada GETUP.
Mantido o limite de velocidade: 140°/s na pata que coça; elevação inicial a 40°/s. Os limites de pulso dos servos não foram ampliados.

## Editor de sequências
Abra **Sequências**, escolha um comando, duração e adicione os passos. Também é possível inserir **Esperar**, mudar a duração, reordenar e remover.
Limites: 16 passos, 0,5–30 s por passo, até 3 minutos no total, 20 sequências nomeadas por navegador.
Salvar não inicia a execução. **Reproduzir** é explícito. O próximo passo entra ao terminar o tempo escolhido; tempos curtos podem interromper a animação anterior.
Ao terminar, interromper, fechar o editor, assumir os controles, perder conexão ou colocar a página em segundo plano, a sequência para. Nada recomeça automaticamente após recarregar.
Comandos de manutenção, calibração, testes de servos e Guardar não entram no editor.

## Personalidade automática
O botão usa o motor NPC existente com um perfil parado: curiosidade, acomodação, despertar e descanso, com intervalos de 12–24 s.
Não inicia sozinho ao abrir a página. Qualquer controle manual interrompe; som mudo/volume só alteram o áudio.
O NPC avançado anterior continua em Ações, com suas configurações próprias.

## Validação
Testes nativos verificam limites de ângulo/velocidade, término/retorno, 24 passadas da coçada, áudio nas passadas e respeito a mudo/cancelamento.
Testes do painel verificam catálogo, limites das sequências, interrupção, substituição e perda de conexão.
A interface foi exercitada com ponte simulada, sem disparar movimentos físicos. Os novos movimentos ainda dependem da avaliação do usuário no robô montado.
