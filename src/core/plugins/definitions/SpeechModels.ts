import { Effect } from 'effect'
import type { SpeechModelId } from '#contract/Subtitles'
import {
  type ComputeDevice,
  huggingFace,
  largest,
  makeSpeechModel,
  oneFile,
  type SpeechManifest,
  type SpeechModelSpec,
} from './SpeechModel'

const gib = 1024 ** 3

// Integrated GPUs report shared system memory, so their size says nothing.
const qwenSize = (devices: ReadonlyArray<ComputeDevice>): SpeechManifest => {
  const discrete = largest(devices, 'gpu')

  if (discrete !== undefined) {
    return { size: discrete.memory >= 6 * gib ? '1.7B' : '0.6B', gpu: discrete.name }
  }

  const integrated = largest(devices, 'integrated')

  return integrated === undefined ? { size: '0.6B' } : { size: '0.6B', gpu: integrated.name }
}

export const speechModelSpecs: Record<SpeechModelId, SpeechModelSpec> = {
  'qwen3-asr': {
    id: 'qwen3-asr',
    version: 'q8_0-0e0a596-7e7c69a',
    description:
      'Recognises speech in 30 languages, Japanese, Chinese and Korean among them, on your GPU or CPU. Wenbu translates it with your presets.',
    license: 'Apache-2.0',
    sourceLabel: 'Hugging Face · Qwen/Qwen3-ASR',
    sourceUrl: 'https://huggingface.co/Qwen/Qwen3-ASR-1.7B',
    sizes: {
      '1.7B': {
        file: 'Qwen3-ASR-1.7B-Q8_0.gguf',
        url: huggingFace(
          'handy-computer/Qwen3-ASR-1.7B-gguf',
          '0e0a596e3959c3f3f2ab7d443a5b6f0f4a4bba6f',
          'Qwen3-ASR-1.7B-Q8_0.gguf',
        ),
        sha256: '9a0d81792dfea2d5f278b8a63deb3ea6e02139ce42c2301f32ea19c4f77526b7',
        bytes: 2_185_030_624,
      },
      '0.6B': {
        file: 'Qwen3-ASR-0.6B-Q8_0.gguf',
        url: huggingFace(
          'handy-computer/Qwen3-ASR-0.6B-gguf',
          '7e7c69a577fa2725dfedbe34b5e999336e30a19b',
          'Qwen3-ASR-0.6B-Q8_0.gguf',
        ),
        sha256: 'f081b2d5e23bd669d92cc331d722a8a0681943b8e6f34b48996fd5c319b5acd8',
        bytes: 850_423_456,
      },
    },
    choose: qwenSize,
  },
  'sensevoice-small': {
    id: 'sensevoice-small',
    version: 'q8_0-ff8f085',
    description:
      'Recognises Chinese, Cantonese, Japanese, Korean and English several times faster than the larger models, so it keeps up on a modest GPU or the CPU.',
    license: 'FunASR Model License',
    sourceLabel: 'Hugging Face · FunAudioLLM/SenseVoiceSmall',
    sourceUrl: 'https://huggingface.co/FunAudioLLM/SenseVoiceSmall',
    sizes: {
      Q8_0: {
        file: 'SenseVoiceSmall-Q8_0.gguf',
        url: huggingFace(
          'handy-computer/SenseVoiceSmall-gguf',
          'ff8f085a8fa2e5ccae0e849ef19ebc6dc18e608b',
          'SenseVoiceSmall-Q8_0.gguf',
        ),
        sha256: '6c759ee4c9748c9b3f7a5a60ca74f0f7e685fb9d45d1378fce7cfd62f59adf29',
        bytes: 252_684_608,
      },
    },
    choose: oneFile('Q8_0'),
  },
  'whisper-large-v3-turbo': {
    id: 'whisper-large-v3-turbo',
    version: 'q8_0-18ada75',
    description:
      "OpenAI's Whisper, recognising speech in about 100 languages and strong on Japanese and Korean. Slower per line than Qwen3-ASR.",
    license: 'MIT',
    sourceLabel: 'Hugging Face · openai/whisper-large-v3-turbo',
    sourceUrl: 'https://huggingface.co/openai/whisper-large-v3-turbo',
    sizes: {
      Q8_0: {
        file: 'whisper-large-v3-turbo-Q8_0.gguf',
        url: huggingFace(
          'handy-computer/whisper-large-v3-turbo-gguf',
          '18ada752005f5fddef499256f9a458d0b37a203a',
          'whisper-large-v3-turbo-Q8_0.gguf',
        ),
        sha256: '257aa7ec9121c22c167d5e2c49e3e76b4ba0e6e27ebc13074eba0a80f8190220',
        bytes: 886_381_728,
      },
    },
    choose: oneFile('Q8_0'),
  },
  'fun-asr-mlt-nano': {
    id: 'fun-asr-mlt-nano',
    version: 'q8_0-08f28da',
    description:
      'Recognises 31 languages with a focus on East and Southeast Asia, strongest on Japanese and Chinese. It does not report the language it hears.',
    license: 'FunASR Model License',
    sourceLabel: 'Hugging Face · FunAudioLLM/Fun-ASR-MLT-Nano-2512',
    sourceUrl: 'https://huggingface.co/FunAudioLLM/Fun-ASR-MLT-Nano-2512',
    sizes: {
      Q8_0: {
        file: 'Fun-ASR-MLT-Nano-2512-Q8_0.gguf',
        url: huggingFace(
          'handy-computer/Fun-ASR-MLT-Nano-2512-gguf',
          '08f28dadd984030331802b2f9fbd9ecac97bf834',
          'Fun-ASR-MLT-Nano-2512-Q8_0.gguf',
        ),
        sha256: '419d350b220d5a1d398740ec1511c8ea751517f2157043a73a399b76b60f21e4',
        bytes: 891_271_392,
      },
    },
    choose: oneFile('Q8_0'),
  },
}

export const makeSpeechModels = Effect.all(
  Object.values(speechModelSpecs).map((spec) => makeSpeechModel(spec)),
)
