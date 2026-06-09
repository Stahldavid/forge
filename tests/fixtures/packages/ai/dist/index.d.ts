/**
 * Generate text from a language model.
 */
export declare function generateText(options: GenerateTextOptions): Promise<GenerateTextResult>;

export interface GenerateTextOptions {
  model: LanguageModel;
  prompt: string;
}

export interface GenerateTextResult {
  text: string;
}

export interface LanguageModel {
  modelId: string;
}

export declare function streamText(options: GenerateTextOptions): AsyncIterable<string>;
