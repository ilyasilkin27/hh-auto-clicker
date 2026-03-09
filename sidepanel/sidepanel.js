class HHAutoResponderPanel {
    constructor() {
        this.isRunning = false;
        this.responseCount = 0;
        this.maxResponses = 50;
        
        this.initializeElements();
        this.attachEventListeners();
        this.initializeMessageListener();
        this.loadSettings();
        this.loadProgress(); // Загружаем прогресс при инициализации
    }

    initializeElements() {
        this.startAutoBtn = document.getElementById('startAutoBtn');
        this.stopAutoBtn = document.getElementById('stopAutoBtn');
        this.coverLetter = document.getElementById('coverLetter');
        this.maxResponsesInput = document.getElementById('maxResponses');
        this.status = document.getElementById('status');
        this.responseCountElement = document.getElementById('responseCount');
        this.progressElement = document.getElementById('progress');
    }

    attachEventListeners() {
        this.startAutoBtn.addEventListener('click', () => this.startAutoRespond());
        this.stopAutoBtn.addEventListener('click', () => this.stopAutoRespond());
        this.coverLetter.addEventListener('change', () => this.saveSettings());
        this.maxResponsesInput.addEventListener('change', () => this.saveSettings());
    }

    initializeMessageListener() {
        chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
            if (request.action === 'updateStats') {
                this.updateStats(request.data);
            }
            return true;
        });
    }

    async startAutoRespond() {
        try {
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
            
            if (!tab.url.includes('hh.ru')) {
                this.updateStatus('❌ Откройте страницу HH.ru', 'error');
                return;
            }

            this.isRunning = true;
            this.responseCount = 0; // Сбрасываем счетчик при новом запуске
            this.startAutoBtn.disabled = true;
            this.stopAutoBtn.disabled = false;
            this.updateStatus('Автоотклики запущены', 'running');
            
            // Сохраняем настройки перед запуском
            this.saveSettings();
            this.saveProgress();
            
            const settings = this.getSettings();
            
            chrome.tabs.sendMessage(tab.id, {
                action: 'startAutoRespond',
                settings: settings
            });
            
        } catch (error) {
            this.updateStatus(`❌ Ошибка запуска: ${error.message}`, 'error');
        }
    }

    async stopAutoRespond() {
        try {
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
            
            this.isRunning = false;
            this.startAutoBtn.disabled = false;
            this.stopAutoBtn.disabled = true;
            this.updateStatus('Готов к работе', 'ready');
            
            // Сохраняем прогресс при остановке
            this.saveProgress();
            
            await chrome.tabs.sendMessage(tab.id, { action: 'stopAutoRespond' });
            
        } catch (error) {
            this.updateStatus(`❌ Ошибка остановки: ${error.message}`, 'error');
        }
    }

    updateStats(data) {
        this.responseCount = data.count || 0;
        this.maxResponses = data.maxResponses || 50;
        this.isRunning = data.isRunning !== undefined ? data.isRunning : this.isRunning;
        
        // Обновляем UI
        this.responseCountElement.textContent = this.responseCount;
        
        if (this.progressElement) {
            const percent = this.maxResponses > 0 ? (this.responseCount / this.maxResponses) * 100 : 0;
            this.progressElement.textContent = `${this.responseCount}/${this.maxResponses} (${Math.round(percent)}%)`;
        }
        
        // Сохраняем прогресс
        this.saveProgress();
        
        // Обновляем статус кнопок
        this.startAutoBtn.disabled = this.isRunning;
        this.stopAutoBtn.disabled = !this.isRunning;
        
        // Обновляем статус
        if (this.isRunning) {
            this.updateStatus(`Автоотклики запущены (${this.responseCount}/${this.maxResponses})`, 'running');
            
            // Автоматически останавливаем если достигли лимита
            if (this.responseCount >= this.maxResponses) {
                this.log('🏁 Достигнут лимит откликов, останавливаем...');
                this.stopAutoRespond();
            }
        } else {
            this.updateStatus('Готов к работе', 'ready');
        }
    }

    updateStatus(message, type = 'info') {
        this.status.textContent = message;
        this.status.className = 'status';
        
        if (type === 'error') {
            this.status.style.background = '#f8d7da';
            this.status.style.color = '#721c24';
        } else if (type === 'running') {
            this.status.style.background = '#d1ecf1';
            this.status.style.color = '#0c5460';
        } else {
            this.status.style.background = '#e9ecef';
            this.status.style.color = '#6c757d';
        }
    }

    getSettings() {
        return {
            coverLetter: this.coverLetter.value,
            maxResponses: parseInt(this.maxResponsesInput.value) || 50
        };
    }

    saveSettings() {
        const settings = this.getSettings();
        chrome.storage.local.set({ 
            settings: settings,
            maxResponses: settings.maxResponses // Сохраняем отдельно для быстрого доступа
        });
    }

    saveProgress() {
        chrome.storage.local.set({
            progress: {
                count: this.responseCount,
                maxResponses: this.maxResponses,
                isRunning: this.isRunning,
                timestamp: Date.now()
            }
        });
    }

    loadSettings() {
        chrome.storage.local.get(['settings', 'maxResponses', 'progress'], (result) => {
            if (result.settings) {
                this.coverLetter.value = result.settings.coverLetter || 'Добрый день! Заинтересовала ваша вакансия. Готов рассмотреть предложение.';
                this.maxResponsesInput.value = result.settings.maxResponses || 50;
                this.maxResponses = result.settings.maxResponses || 50;
            } else if (result.maxResponses) {
                this.maxResponsesInput.value = result.maxResponses;
                this.maxResponses = result.maxResponses;
            }
            
            this.loadProgress(); // Загружаем прогресс после загрузки настроек
        });
    }

    loadProgress() {
        chrome.storage.local.get(['progress'], (result) => {
            if (result.progress) {
                this.responseCount = result.progress.count || 0;
                this.maxResponses = result.progress.maxResponses || this.maxResponses;
                this.isRunning = result.progress.isRunning || false;
                
                // Обновляем UI
                this.updateStats({
                    count: this.responseCount,
                    maxResponses: this.maxResponses,
                    isRunning: this.isRunning
                });
            }
        });
    }

    log(message) {
        console.log(`[Side Panel] ${message}`);
    }
}

// Инициализация
document.addEventListener('DOMContentLoaded', () => {
    window.hhAutoResponderPanel = new HHAutoResponderPanel();
});