// Minimal types for the Khronos glTF-Validator npm package (it ships none).
declare module 'gltf-validator' {
  export interface ValidationMessage {
    code: string;
    message: string;
    /** 0 error, 1 warning, 2 info, 3 hint. */
    severity: number;
    pointer?: string;
  }
  export interface ValidationReport {
    issues: { numErrors: number; numWarnings: number; numInfos: number; numHints: number; messages: ValidationMessage[] };
  }
  export function validateBytes(data: Uint8Array, options?: { maxIssues?: number; format?: 'glb' | 'gltf'; uri?: string }): Promise<ValidationReport>;
  export function version(): string;
}
