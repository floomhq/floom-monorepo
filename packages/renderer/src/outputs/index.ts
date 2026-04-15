// 10 default output components, keyed by their canonical OutputShape.
// Host code switches on RenderProps.schema via pickOutputShape() to find
// the right default when no custom renderer is shipped.

import React from 'react';
import type { OutputShape, RenderProps } from '../contract/index.js';
import { TextOutput } from './TextOutput.js';
import { MarkdownOutput } from './MarkdownOutput.js';
import { CodeOutput } from './CodeOutput.js';
import { TableOutput, rowsToCsv } from './TableOutput.js';
import { ObjectOutput } from './ObjectOutput.js';
import { ImageOutput, coerceImageSrc } from './ImageOutput.js';
import { PdfOutput, coercePdfSrc } from './PdfOutput.js';
import { AudioOutput, coerceAudioSrc } from './AudioOutput.js';
import { StreamOutput, eventsToLines } from './StreamOutput.js';
import { ErrorOutput } from './ErrorOutput.js';

export {
  TextOutput,
  MarkdownOutput,
  CodeOutput,
  TableOutput,
  ObjectOutput,
  ImageOutput,
  PdfOutput,
  AudioOutput,
  StreamOutput,
  ErrorOutput,
  rowsToCsv,
  coerceImageSrc,
  coercePdfSrc,
  coerceAudioSrc,
  eventsToLines,
};

export const defaultOutputs: Record<OutputShape, React.ComponentType<RenderProps>> = {
  text: TextOutput,
  markdown: MarkdownOutput,
  code: CodeOutput,
  table: TableOutput,
  object: ObjectOutput,
  image: ImageOutput,
  pdf: PdfOutput,
  audio: AudioOutput,
  stream: StreamOutput,
  error: ErrorOutput,
};

/** Lookup a default output component by shape. Never throws; unknown shapes fall back to TextOutput. */
export function getDefaultOutput(shape: OutputShape | string | undefined | null): React.ComponentType<RenderProps> {
  if (!shape) return TextOutput;
  const lookup = defaultOutputs[shape as OutputShape];
  return lookup || TextOutput;
}
