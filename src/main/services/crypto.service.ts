import { safeStorage } from 'electron';

class CryptoService {
    private isEncryptionAvailable: boolean;

    constructor() {
        this.isEncryptionAvailable = safeStorage.isEncryptionAvailable();
    }

    /**
     * Encrypt a string using Electron's safeStorage
     */
    encrypt(data: string): string {
        if (!this.isEncryptionAvailable) {
            // Fallback: base64 encode (not secure, but better than plaintext)
            console.warn('Encryption not available, using base64 encoding');
            return Buffer.from(data).toString('base64');
        }

        const encrypted = safeStorage.encryptString(data);
        return encrypted.toString('base64');
    }

    /**
     * Decrypt a string using Electron's safeStorage
     */
    decrypt(encryptedData: string): string {
        if (!this.isEncryptionAvailable) {
            // Fallback: base64 decode
            return Buffer.from(encryptedData, 'base64').toString('utf-8');
        }

        const buffer = Buffer.from(encryptedData, 'base64');
        return safeStorage.decryptString(buffer);
    }

    /**
     * Check if encryption is available
     */
    isAvailable(): boolean {
        return this.isEncryptionAvailable;
    }
}

export const cryptoService = new CryptoService();
