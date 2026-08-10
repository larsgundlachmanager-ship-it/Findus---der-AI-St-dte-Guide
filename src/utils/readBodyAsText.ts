type BodyReader = {
  text?: () => Promise<string>;
  arrayBuffer?: () => Promise<ArrayBuffer>;
  blob?: () => Promise<unknown>;
};

/** Read fetch Response bodies across RN (Response may lack .text()). */
export async function readResponseAsText(res: Response): Promise<string> {
  const reader = res as Response & BodyReader;
  if (typeof reader.text === 'function') {
    try {
      return await reader.text();
    } catch {
      /* fall through to arrayBuffer/blob */
    }
  }
  if (typeof reader.arrayBuffer === 'function') {
    const buf = await reader.arrayBuffer();
    return new TextDecoder('utf-8').decode(buf);
  }
  if (typeof reader.blob === 'function') {
    return readBodyAsText(await reader.blob());
  }
  throw new Error('Unbekanntes Download-Format');
}

/** Read Supabase/fetch download bodies across RN (Blob may lack .text()). */
export async function readBodyAsText(data: unknown): Promise<string> {
  if (typeof data === 'string') return data;
  if (data instanceof ArrayBuffer) {
    return new TextDecoder('utf-8').decode(data);
  }
  if (ArrayBuffer.isView(data)) {
    return new TextDecoder('utf-8').decode(data as ArrayBufferView);
  }
  const maybeBlob = data as {
    text?: () => Promise<string>;
    arrayBuffer?: () => Promise<ArrayBuffer>;
  };
  if (typeof maybeBlob?.text === 'function') {
    return maybeBlob.text();
  }
  if (typeof maybeBlob?.arrayBuffer === 'function') {
    const buf = await maybeBlob.arrayBuffer();
    return new TextDecoder('utf-8').decode(buf);
  }
  if (typeof FileReader !== 'undefined' && data && typeof data === 'object') {
    return new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result ?? ''));
      reader.onerror = () => reject(reader.error ?? new Error('FileReader'));
      reader.readAsText(data as Blob);
    });
  }
  throw new Error('Unbekanntes Download-Format');
}
