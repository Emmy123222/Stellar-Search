import { describe, it, expect, vi } from 'vitest';
import { consumeSSE } from './sse';

describe('consumeSSE', () => {
  const encoder = new TextEncoder();

  // Helper to create a ReadableStream from chunks (arrays of strings to simulate fragmentation)
  function createStream(chunks: string[]) {
    return new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) {
          controller.enqueue(encoder.encode(chunk));
        }
        controller.close();
      }
    });
  }

  it('parses standard LF delimited SSE events', async () => {
    const onDelta = vi.fn();
    const stream = createStream([
      'event: delta\ndata: {"content": "hello"}\n\n',
      'event: delta\ndata: {"content": " world"}\n\n',
      'event: done\ndata: {}\n\n'
    ]);

    await consumeSSE(stream, onDelta);
    expect(onDelta).toHaveBeenCalledTimes(2);
    expect(onDelta).toHaveBeenNthCalledWith(1, 'hello');
    expect(onDelta).toHaveBeenNthCalledWith(2, ' world');
  });

  it('handles CRLF and fragmented chunk boundaries', async () => {
    const onDelta = vi.fn();
    const stream = createStream([
      'event: delta\r\nda',
      'ta: {"content": "1"}\r\n\r',
      '\nevent: delta\r\ndata: {"content": "2"}\r\n\r\nevent: do',
      'ne\r\ndata: {}\r\n\r\n'
    ]);

    await consumeSSE(stream, onDelta);
    expect(onDelta).toHaveBeenCalledTimes(2);
    expect(onDelta).toHaveBeenNthCalledWith(1, '1');
    expect(onDelta).toHaveBeenNthCalledWith(2, '2');
  });

  it('ignores comments and empty lines', async () => {
    const onDelta = vi.fn();
    const stream = createStream([
      ': this is a comment\n',
      '\n', // Empty blank lines
      'event: delta\ndata: {"content": "ok"}\n\n',
      'event: done\ndata: {}\n\n'
    ]);

    await consumeSSE(stream, onDelta);
    expect(onDelta).toHaveBeenCalledTimes(1);
    expect(onDelta).toHaveBeenCalledWith('ok');
  });

  it('supports multi-line data', async () => {
    const onDelta = vi.fn();
    const stream = createStream([
      'event: delta\ndata: {"con"\ndata: "tent": "multi"}\n\n',
      'event: done\ndata: {}\n\n'
    ]);

    await consumeSSE(stream, onDelta);
    expect(onDelta).toHaveBeenCalledTimes(1);
    expect(onDelta).toHaveBeenCalledWith('multi');
  });

  it('flushes premature EOF buffer if it has a valid event', async () => {
    const onDelta = vi.fn();
    const stream = createStream([
      'event: delta\ndata: {"content": "eof"}'
    ]); // No trailing newline

    await consumeSSE(stream, onDelta);
    expect(onDelta).toHaveBeenCalledTimes(1);
    expect(onDelta).toHaveBeenCalledWith('eof');
  });

  it('throws on error event', async () => {
    const stream = createStream([
      'event: error\ndata: {"error": "rate limited"}\n\n'
    ]);
    
    await expect(consumeSSE(stream, vi.fn())).rejects.toThrow('rate limited');
  });

  it('stops processing on done event and cancels stream', async () => {
    const onDelta = vi.fn();
    let cancelCalled = false;
    
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode('event: done\ndata: {"model": "gpt-4"}\n\n'));
        controller.enqueue(encoder.encode('event: delta\ndata: {"content": "ignored"}\n\n'));
      },
      cancel() {
        cancelCalled = true;
      }
    });

    const onModel = vi.fn();
    await consumeSSE(stream, onDelta, onModel);
    
    expect(onDelta).not.toHaveBeenCalled();
    expect(onModel).toHaveBeenCalledWith('gpt-4');
    expect(cancelCalled).toBe(true);
  });
});
