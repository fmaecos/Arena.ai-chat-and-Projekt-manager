"""Optional local OpenAI-compatible transcription endpoint for Kontext.

Install once with `python -m pip install faster-whisper`. No audio is saved.
The selected model is downloaded from Hugging Face on first start if uncached.
"""
import argparse
from email.parser import BytesParser
from email.policy import default
from http.server import BaseHTTPRequestHandler, HTTPServer
from io import BytesIO
import json

MAX_BODY = 6 * 1024 * 1024 + 64 * 1024


def run():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--model', default='base', help='Multilingual faster-whisper model name or directory')
    parser.add_argument('--port', type=int, default=17861)
    args = parser.parse_args()
    from faster_whisper import WhisperModel
    print(f'Loading Whisper model {args.model} ...', flush=True)
    model = WhisperModel(args.model, device='cpu', compute_type='int8')

    class Handler(BaseHTTPRequestHandler):
        def respond(self, status, payload):
            data = json.dumps(payload).encode('utf-8')
            self.send_response(status)
            self.send_header('Content-Type', 'application/json; charset=utf-8')
            self.send_header('Content-Length', str(len(data)))
            self.send_header('Cache-Control', 'no-store')
            self.end_headers()
            try:
                self.wfile.write(data)
            except (BrokenPipeError, ConnectionResetError):
                pass

        def do_POST(self):
            if self.path != '/v1/audio/transcriptions':
                return self.respond(404, {'error': 'Unknown endpoint'})
            if self.headers.get('Origin') or self.headers.get('Host') not in (
                f'127.0.0.1:{args.port}', f'localhost:{args.port}'
            ) or self.headers.get('X-Kontext-Audio') != '1':
                return self.respond(403, {'error': 'Only local Kontext requests are accepted'})
            try:
                length = int(self.headers.get('Content-Length', '0'))
                content_type = self.headers.get('Content-Type', '')
                if not 0 < length <= MAX_BODY or not content_type.startswith('multipart/form-data;'):
                    return self.respond(400, {'error': 'Expected multipart audio, up to 6 MiB'})
                content = BytesParser(policy=default).parsebytes(
                    f'Content-Type: {content_type}\r\n\r\n'.encode('ascii') + self.rfile.read(length)
                )
                audio = next((p.get_payload(decode=True) for p in content.iter_parts()
                              if p.get_param('name', header='content-disposition') == 'file'), b'')
                if not audio:
                    return self.respond(400, {'error': 'Missing file part'})
                segments, _ = model.transcribe(BytesIO(audio), language='de', beam_size=3, vad_filter=True)
                return self.respond(200, {'text': ' '.join(s.text.strip() for s in segments)})
            except (ValueError, UnicodeError):
                return self.respond(400, {'error': 'Invalid audio request'})
            except Exception:
                return self.respond(422, {'error': 'Audio could not be transcribed'})

    with HTTPServer(('127.0.0.1', args.port), Handler) as server:
        print(f'Whisper listening on http://127.0.0.1:{args.port}', flush=True)
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            pass


if __name__ == '__main__':
    run()
