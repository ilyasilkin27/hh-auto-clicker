// Background Service Worker для HH Auto Responder
class HHAutoResponderBackground {
    constructor() {
        this.initializeService();
    }

    initializeService() {
        this.setupMessageListener();
        this.setupSidePanel();
        this.setupTabMonitoring();
        this.log('Background service инициализирован');
    }

    setupMessageListener() {
        chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
            this.log(`Получено сообщение: ${request.action}`, 'debug');
            
            switch (request.action) {
                case 'responseProgress':
                    // Пересылаем прогресс в side panel
                    this.forwardToSidePanel({
                        action: 'updateStats',
                        data: request.data
                    });
                    break;
                    
                case 'log':
                    this.forwardToSidePanel(request);
                    break;
                    
                default:
                    // Пробрасываем сообщение в активную вкладку
                    this.forwardToActiveTab(request, sender);
                    return false;
            }
        });
    }

    setupSidePanel() {
        // Автоматически включаем Side Panel для HH.ru
        chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
            if (changeInfo.status === 'complete' && tab.url && this.isHHUrl(tab.url)) {
                chrome.sidePanel.setOptions({
                    tabId,
                    path: 'sidepanel/sidepanel.html',
                    enabled: true
                }).catch((error) => {
                    this.log(`Ошибка настройки Side Panel: ${error.message}`, 'debug');
                });
            }
        });
    }

    setupTabMonitoring() {
        // Мониторим активные вкладки для обновления статуса
        chrome.tabs.onActivated.addListener((activeInfo) => {
            this.updateSidePanelForTab(activeInfo.tabId);
        });

        chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
            if (changeInfo.status === 'complete') {
                this.updateSidePanelForTab(tabId);
            }
        });
    }

    async updateSidePanelForTab(tabId) {
        try {
            const tab = await chrome.tabs.get(tabId);
            if (tab.url && this.isHHUrl(tab.url)) {
                await chrome.sidePanel.setOptions({
                    tabId,
                    enabled: true
                });
            } else {
                await chrome.sidePanel.setOptions({
                    tabId,
                    enabled: false
                });
            }
        } catch (error) {
            this.log(`Ошибка обновления Side Panel: ${error.message}`, 'debug');
        }
    }

    forwardToSidePanel(message) {
        // Отправляем данные во все side panels
        chrome.runtime.sendMessage(message).catch(error => {
            // Игнорируем ошибки когда side panel закрыт
        });
    }

    async forwardToActiveTab(request, sender) {
        try {
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
            if (tab && tab.id !== sender.tab?.id) {
                chrome.tabs.sendMessage(tab.id, request).catch(() => {
                    // Игнорируем ошибки отправки
                });
            }
        } catch (error) {
            this.log(`Ошибка пересылки сообщения: ${error.message}`, 'error');
        }
    }

    isHHUrl(url) {
        return url.includes('hh.ru') || url.includes('headhunter');
    }

    log(message, level = 'info') {
        const timestamp = new Date().toLocaleTimeString();
        const logEntry = `[${timestamp}] [${level}] ${message}`;
        
        if (level === 'error') {
            console.error(logEntry);
        } else if (level === 'debug') {
            console.debug(logEntry);
        } else {
            console.log(logEntry);
        }
    }
}

// Инициализируем background service
const hhAutoResponderBackground = new HHAutoResponderBackground();

// Обработчики жизненного цикла
chrome.runtime.onStartup.addListener(() => {
    hhAutoResponderBackground.log('Extension started on browser startup');
});

chrome.runtime.onSuspend.addListener(() => {
    hhAutoResponderBackground.log('Extension suspending');
});