# Chat/Progress Display Fix

## Problema
Tres sistemas de render compiten: chat-ui.js renderMessages(), main.js inline throttled render, main.js direct DOM update.

## Solucion
Unificar todo en chat-ui.js renderMessages(). El WS handler en main.js solo actualiza datos y llama a renderMessages().

## Cambios

### main.js WS handler (lines 7509-7762)
- REMOVER: direct DOM update (lines 7607-7740)
- REMOVER: inline throttled render with its own progress HTML (lines 7627-7738)
- ADD: throttled renderMessages() call
- ADD: update chat.thinkingSubtext on each tool line

### chat-ui.js renderMessages()
- VERIFIED: already handles activeProgress, lastFinishedProgress, isThinking, fallback
- ADD: performance guard - if content hasn't changed, skip re-render
- ADD: thinkingSubtext updates from chat object
