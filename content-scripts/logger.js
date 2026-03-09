class HHAutoResponderLogger {
    constructor() {
        this.logs = [];
    }

    log(message, level = 'info', source = 'content') {
        const logEntry = {
            timestamp: new Date().toLocaleString(),
            level,
            source,
            message,
            url: window.location.href
        };

        this.logs.push(logEntry);
        
        // Отправляем в Side Panel
        this.sendToPanel('log', { message, level });
        
        // Локальная консоль для отладки
        const consoleMethod = level === 'error' ? 'error' : 
                            level === 'warning' ? 'warn' : 'log';
        console[consoleMethod](`[HH Auto Responder] ${message}`);
    }

    sendToPanel(action, data = {}) {
        try {
            chrome.runtime.sendMessage({
                action,
                ...data
            });
        } catch (error) {
            // Игнорируем ошибки отправки
        }
    }

    getLogs() {
        return this.logs;
    }

    clearLogs() {
        this.logs = [];
    }
}

// Глобальный логгер
window.hhResponderLogger = new HHAutoResponderLogger();
window.hhResponderLogger.log('Логгер инициализирован', 'info');