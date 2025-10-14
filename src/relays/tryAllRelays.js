const JSON_RPC_HEADERS = {
  'content-type': 'application/json',
  accept: 'application/json'
};

function makePayload(rawTx, id) {
  return JSON.stringify({
    jsonrpc: '2.0',
    id,
    method: 'eth_sendRawTransaction',
    params: [rawTx]
  });
}

export async function tryAllRelays(relays = [], rawTx) {
  if (!Array.isArray(relays)) {
    relays = typeof relays === 'string' ? relays.split(',').map(r => r.trim()).filter(Boolean) : [];
  }

  if (relays.length === 0) {
    return { success: false, errors: [{ relay: null, error: new Error('No relays configured') }] };
  }

  const errors = [];
  let counter = 1;

  for (const relay of relays) {
    if (!relay) continue;
    try {
      const response = await fetch(relay, {
        method: 'POST',
        headers: JSON_RPC_HEADERS,
        body: makePayload(rawTx, counter++)
      });

      if (!response.ok) {
        const err = new Error(`HTTP ${response.status}`);
        err.status = response.status;
        errors.push({ relay, error: err });
        continue;
      }

      const body = await response.json();
      if (body?.error) {
        const err = new Error(body.error.message || 'Relay error');
        err.code = body.error.code;
        errors.push({ relay, error: err });
        continue;
      }

      if (body?.result) {
        return { success: true, txHash: body.result, relay };
      }

      errors.push({ relay, error: new Error('Unknown relay response') });
    } catch (error) {
      errors.push({ relay, error });
    }
  }

  return { success: false, errors };
}
