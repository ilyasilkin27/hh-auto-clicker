// Вспомогательные функции для HH Auto Responder
class HHResponderHelpers {
    static generateId() {
        return Date.now().toString(36) + Math.random().toString(36).substr(2, 9);
    }

    static delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    static randomDelay(min, max) {
        const ms = min + Math.random() * (max - min);
        return this.delay(ms);
    }

    static isElementVisible(element) {
        if (!element) return false;
        
        const style = window.getComputedStyle(element);
        return style.display !== 'none' && 
               style.visibility !== 'hidden' && 
               element.offsetWidth > 0 && 
               element.offsetHeight > 0;
    }

    static waitForElement(selector, timeout = 10000) {
        return new Promise((resolve, reject) => {
            const element = document.querySelector(selector);
            if (element) {
                resolve(element);
                return;
            }

            const observer = new MutationObserver((mutations, obs) => {
                const element = document.querySelector(selector);
                if (element) {
                    obs.disconnect();
                    resolve(element);
                }
            });

            observer.observe(document.body, {
                childList: true,
                subtree: true
            });

            setTimeout(() => {
                observer.disconnect();
                reject(new Error(`Element ${selector} not found within ${timeout}ms`));
            }, timeout);
        });
    }

    static scrollToElement(element, behavior = 'smooth') {
        element.scrollIntoView({ 
            behavior, 
            block: 'center',
            inline: 'center'
        });
    }

    static simulateHumanClick(element) {
        // Симуляция человеческого клика с небольшой задержкой
        return new Promise(resolve => {
            setTimeout(() => {
                element.click();
                resolve();
            }, 100 + Math.random() * 200);
        });
    }

    static getPageInfo() {
        return {
            url: window.location.href,
            title: document.title,
            timestamp: new Date().toISOString(),
            userAgent: navigator.userAgent
        };
    }

    static sanitizeText(text) {
        return text.replace(/[^\w\sа-яА-ЯёЁ.,!?-]/gi, '').substring(0, 1000);
    }

    static formatNumber(num) {
        return new Intl.NumberFormat('ru-RU').format(num);
    }

    static retry(fn, retries = 3, delay = 1000) {
        return new Promise((resolve, reject) => {
            const attempt = (attemptNumber) => {
                fn()
                    .then(resolve)
                    .catch((error) => {
                        if (attemptNumber < retries) {
                            setTimeout(() => attempt(attemptNumber + 1), delay);
                        } else {
                            reject(error);
                        }
                    });
            };
            
            attempt(1);
        });
    }
}

// Экспортируем для использования в других модулях
if (typeof module !== 'undefined' && module.exports) {
    module.exports = HHResponderHelpers;
} else {
    window.HHResponderHelpers = HHResponderHelpers;
}