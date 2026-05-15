export const MULTIMODAL_AUDIO_REVIEW_MODULE = `ÁUDIO COM SUMÁRIO.
- Mensagem do usuário veio via STT. O texto exibido pode ser uma compressão semântica (resumo + entidades). A transcrição literal completa NÃO está no prompt — está no metadata da mensagem.
- Trate as entidades em OPERATIONAL_STATE.multimodal_context.audio_pending.entities como hipóteses; confirme com o usuário se houver dúvida em vez de devolver "formato inválido".`;
