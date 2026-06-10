import net from 'net';

const SERVERDATA_AUTH = 3;
const SERVERDATA_EXECCOMMAND = 2;
const SERVERDATA_RESPONSE_VALUE = 0;

function buildPacket(id, type, body) {
  const bodyBuffer = Buffer.from(String(body || ''), 'utf8');
  const packet = Buffer.alloc(4 + 4 + bodyBuffer.length + 2);
  packet.writeInt32LE(id, 0);
  packet.writeInt32LE(type, 4);
  bodyBuffer.copy(packet, 8);
  packet.writeInt8(0, 8 + bodyBuffer.length);
  packet.writeInt8(0, 9 + bodyBuffer.length);

  const out = Buffer.alloc(4 + packet.length);
  out.writeInt32LE(packet.length, 0);
  packet.copy(out, 4);
  return out;
}

function parsePackets(buffer) {
  const packets = [];
  let offset = 0;
  while (offset + 4 <= buffer.length) {
    const length = buffer.readInt32LE(offset);
    if (offset + 4 + length > buffer.length) break;
    const start = offset + 4;
    const id = buffer.readInt32LE(start);
    const type = buffer.readInt32LE(start + 4);
    const body = buffer.slice(start + 8, start + length - 2).toString('utf8');
    packets.push({ id, type, body });
    offset += 4 + length;
  }
  return packets;
}

export function sendRconCommand({ host, port, password, command, timeoutMs = 5000 }) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host, port: Number(port) });
    let buffer = Buffer.alloc(0);
    let authenticated = false;
    let done = false;

    const finish = (err, value) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      socket.destroy();
      if (err) reject(err);
      else resolve(value);
    };

    const timer = setTimeout(() => finish(new Error('RCON request timed out')), timeoutMs);

    socket.on('connect', () => {
      socket.write(buildPacket(1, SERVERDATA_AUTH, password));
    });

    socket.on('data', chunk => {
      buffer = Buffer.concat([buffer, chunk]);
      const packets = parsePackets(buffer);
      for (const packet of packets) {
        if (!authenticated) {
          if (packet.id === -1) return finish(new Error('RCON authentication failed'));
          authenticated = true;
          socket.write(buildPacket(2, SERVERDATA_EXECCOMMAND, command));
          socket.write(buildPacket(3, SERVERDATA_RESPONSE_VALUE, ''));
          continue;
        }

        if (packet.id === 2) {
          return finish(null, packet.body || '(no response)');
        }
      }
    });

    socket.on('error', err => finish(err));
  });
}
