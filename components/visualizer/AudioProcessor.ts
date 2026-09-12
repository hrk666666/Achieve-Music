// AudioProcessor.ts (AudioWorklet)

// Declare AudioWorkletGlobalScope types since they are not in the default TS lib
interface AudioWorkletProcessor {
    readonly port: MessagePort;
    process(inputs: Float32Array[][], outputs: Float32Array[][], parameters: Record<string, Float32Array>): boolean;
}

declare var AudioWorkletProcessor: {
    prototype: AudioWorkletProcessor;
    new(options?: any): AudioWorkletProcessor;
};

declare function registerProcessor(name: string, processorCtor: (new (options?: any) => AudioWorkletProcessor)): void;


class AudioProcessor extends AudioWorkletProcessor {
    port2: MessagePort | null = null;
    constructor() {
        super();
        this.port2 = null;
        this.port.onmessage = (e) => {

            if (e.data.type === 'PORT') {
                this.port2 = e.data.port;

                this.port.postMessage({ type: 'PORT_RECEIVED' });
            }
        };

    }

    process(inputs: Float32Array[][], outputs: Float32Array[][], parameters: Record<string, Float32Array>): boolean {
        // We only care about the first input
        const input = inputs[0];
        if (!input || input.length === 0) return true;

        const channelData = input[0]; // Mono or Left channel

        // If we have a port to the worker, send data
        if (this.port2) {

            // We send a copy. 128 samples is small.
            const data = new Float32Array(channelData);
            this.port2.postMessage({ type: 'AUDIO_DATA', data }, [data.buffer]);
        }

        return true;
    }
}

registerProcessor('audio-processor', AudioProcessor);
