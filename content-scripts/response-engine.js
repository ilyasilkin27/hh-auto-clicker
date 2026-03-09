class ResponseEngine {
    constructor() {
        this.isRunning = false;
        this.responseCount = 0;
        this.settings = {};
        this.maxResponses = 50;
        this.logger = window.hhResponderLogger;
        
        this.initializeMessageListener();
        this.restoreState();
    }

    async restoreState() {
        try {
            const state = await new Promise(resolve => {
                chrome.storage.local.get(['autoRespondState'], (result) => {
                    resolve(result.autoRespondState);
                });
            });
            
            if (state && state.isRunning) {
                this.isRunning = true;
                this.responseCount = state.responseCount || 0;
                this.maxResponses = state.maxResponses || 50;
                this.settings = state.settings || {};
                
                this.logger.log(`🔄 Восстановлено состояние: ${this.responseCount}/${this.maxResponses} откликов`, 'info', 'engine');
                this.updateProgress();
                
                // Продолжаем процесс после восстановления
                setTimeout(() => this.processResponses(), 2000);
            }
        } catch (error) {
            this.logger.log(`❌ Ошибка восстановления состояния: ${error.message}`, 'error', 'engine');
        }
    }

    async saveState() {
        try {
            const state = {
                isRunning: this.isRunning,
                responseCount: this.responseCount,
                maxResponses: this.maxResponses,
                settings: this.settings,
                timestamp: Date.now()
            };
            
            await new Promise(resolve => {
                chrome.storage.local.set({ autoRespondState: state }, resolve);
            });
        } catch (error) {
            this.logger.log(`❌ Ошибка сохранения состояния: ${error.message}`, 'error', 'engine');
        }
    }

    async clearState() {
        try {
            await new Promise(resolve => {
                chrome.storage.local.remove(['autoRespondState'], resolve);
            });
        } catch (error) {
            this.logger.log(`❌ Ошибка очистки состояния: ${error.message}`, 'error', 'engine');
        }
    }

    initializeMessageListener() {
        chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
            switch (request.action) {
                case 'startAutoRespond':
                    this.startAutoRespond(request.settings);
                    sendResponse({ success: true });
                    break;
                    
                case 'stopAutoRespond':
                    this.stopAutoRespond();
                    sendResponse({ success: true });
                    break;
            }
            return true;
        });
    }

    async startAutoRespond(settings) {
        if (this.isRunning) {
            this.logger.log('⚠️ Автоотклики уже запущены', 'warning', 'engine');
            return;
        }

        this.isRunning = true;
        this.settings = settings;
        this.responseCount = 0;
        this.maxResponses = settings.maxResponses || 50;

        this.logger.log(`🚀 Запуск автооткликов (макс: ${this.maxResponses})`, 'info', 'engine');
        await this.saveState();
        this.updateProgress();

        await this.processResponses();
    }

    async stopAutoRespond() {
        this.isRunning = false;
        this.logger.log('⏹️ Остановка автооткликов', 'info', 'engine');
        await this.clearState();
        this.updateProgress();
    }

    async processResponses() {
        // Даем время странице полностью загрузиться после обновления
        await this.delay(2000);
        
        while (this.isRunning && this.responseCount < this.maxResponses) {
            try {
                this.logger.log(`📊 Отклик ${this.responseCount + 1} из ${this.maxResponses}`, 'info', 'engine');

                const success = await this.tryRespondToVacancy();
                
                if (success) {
                    this.responseCount++;
                    this.logger.log(`✅ Успешных откликов: ${this.responseCount}`, 'success', 'engine');
                    await this.saveState();
                    this.updateProgress();

                    // Если достигли лимита - останавливаемся
                    if (this.responseCount >= this.maxResponses) {
                        this.logger.log(`🏁 Достигнут лимит в ${this.maxResponses} откликов`, 'success', 'engine');
                        await this.stopAutoRespond();
                        break;
                    }
                    
                    // ОБНОВЛЯЕМ СТРАНИЦУ после успешного отклика
                    this.logger.log('🔄 Обновляем страницу...', 'info', 'engine');
                    window.location.reload();
                    
                    // Ждем загрузки страницы после обновления
                    this.logger.log('⏳ Ждем загрузки страницы...', 'info', 'engine');
                    await this.waitForPageLoad();
                    
                } else {
                    this.logger.log('❌ Отклик не удался, пробуем следующую вакансию', 'warning', 'engine');
                    await this.delay(3000);
                }

            } catch (error) {
                this.logger.log(`❌ Ошибка в цикле: ${error.message}`, 'error', 'engine');
                await this.delay(5000);
            }
        }

        if (this.isRunning) {
            this.logger.log(`🏁 Завершено! Всего откликов: ${this.responseCount}`, 'success', 'engine');
            await this.stopAutoRespond();
        }
    }

    async tryRespondToVacancy() {
        try {
            // 1. Находим первую кнопку "Откликнуться"
            const respondButton = document.querySelector('[data-qa="vacancy-serp__vacancy_response"]');
            
            if (!respondButton) {
                this.logger.log('❌ Кнопка "Откликнуться" не найдена', 'warning', 'engine');
                
                // Активируем сценарий скрытия вакансии
                this.logger.log('🔄 Активируем сценарий скрытия вакансии', 'info', 'engine');
                const hideSuccess = await this.hideVacancyAndContinue();
                return hideSuccess;
            }
            
            this.logger.log('1. ✅ Найдена кнопка "Откликнуться"', 'info', 'engine');
            
            // 2. Нажимаем на кнопку "Откликнуться"
            respondButton.click();
            await this.delay(2000);

            // 2.1. Если появилось предупреждение о переезде — жмём "Все равно откликнуться"
            const relocationConfirm = document.querySelector('[data-qa="relocation-warning-confirm"]');
            if (relocationConfirm) {
                this.logger.log('📍 Найдено предупреждение о переезде, нажимаем "Все равно откликнуться"', 'info', 'engine');
                relocationConfirm.click();
                await this.delay(2000);
            }
            
            // 3. Определяем тип открывшейся формы
            const formType = await this.detectFormType();
            this.logger.log(`📋 Тип формы: ${formType}`, 'info', 'engine');
            
            let result = false;
            
            if (formType === 'with_letter_field') {
                // Сценарий 1: Сразу открылась форма с полем для письма
                result = await this.handleFormWithLetterField();
            } else if (formType === 'need_attach_letter') {
                // Сценарий 2: Нужно нажать "Приложить письмо"
                result = await this.handleFormWithAttachButton();
            } else if (formType === 'unknown') {
                // СЦЕНАРИЙ 4: Неизвестный тип формы (уже откликались, но кнопка доступна)
                this.logger.log('🔄 Обнаружен уже отправленный отклик, обновляем страницу', 'info', 'engine');
                window.location.reload();
                await this.delay(3000);
                return false;
            } else {
                this.logger.log('❌ Неизвестный тип формы', 'warning', 'engine');
                return false;
            }
            
            return result;
            
        } catch (error) {
            this.logger.log(`❌ Ошибка отклика: ${error.message}`, 'error', 'engine');
            return false;
        }
    }

    // Определяем тип открывшейся формы
    async detectFormType() {
        // Проверяем, есть ли сразу поле для сопроводительного письма
        const letterField = document.querySelector('[data-qa="vacancy-response-popup-form-letter-input"]');
        if (letterField) {
            return 'with_letter_field';
        }
        
        // Проверяем, есть ли кнопка "Приложить письмо"
        const attachButton = document.querySelector('[data-qa="vacancy-response-letter-toggle"]');
        if (attachButton) {
            return 'need_attach_letter';
        }
        
        // Проверяем, не открылось ли окно с ошибкой или уже отправленным откликом
        const errorMessage = document.querySelector('[data-qa*="error"], [class*="error"], [data-qa*="success"]');
        if (errorMessage) {
            return 'unknown'; // Уже откликались или ошибка
        }
        
        return 'unknown';
    }

    // Обработка формы с сразу открытым полем для письма
    async handleFormWithLetterField() {
        try {
            this.logger.log('📝 Обрабатываем форму с полем для письма', 'info', 'engine');
            
            // 1. Находим поле для письма
            const letterField = document.querySelector('[data-qa="vacancy-response-popup-form-letter-input"]');
            if (!letterField) {
                this.logger.log('❌ Поле для письма не найдено', 'warning', 'engine');
                return false;
            }
            
            this.logger.log('2. ✅ Найдено поле для письма', 'info', 'engine');
            
            // 2. Заполняем поле письмом
            const letterText = this.settings.coverLetter || 'Добрый день! Заинтересовала ваша вакансия. Готов рассмотреть предложение.';
            letterField.value = letterText;
            letterField.dispatchEvent(new Event('input', { bubbles: true }));
            letterField.dispatchEvent(new Event('change', { bubbles: true }));
            await this.delay(1000);
            
            this.logger.log('3. ✅ Поле заполнено', 'info', 'engine');
            
            // 3. Ищем кнопку "Откликнуться" в этой форме
            const submitButton = document.querySelector('[data-qa="vacancy-response-submit-popup"]');
            if (!submitButton) {
                this.logger.log('❌ Кнопка "Откликнуться" не найдена', 'warning', 'engine');
                return false;
            }
            
            // Проверяем, не заблокирована ли кнопка
            if (submitButton.disabled) {
                this.logger.log('⚠️ Кнопка "Откликнуться" заблокирована', 'warning', 'engine');
                return false;
            }
            
            this.logger.log('4. ✅ Найдена кнопка "Откликнуться"', 'info', 'engine');
            
            // 4. Нажимаем на кнопку "Откликнуться"
            submitButton.click();
            await this.delay(3000);
            
            this.logger.log('5. ✅ Отклик отправлен', 'success', 'engine');
            return true;
            
        } catch (error) {
            this.logger.log(`❌ Ошибка обработки формы: ${error.message}`, 'error', 'engine');
            return false;
        }
    }

    // Обработка формы с кнопкой "Приложить письмо"
    async handleFormWithAttachButton() {
        try {
            this.logger.log('📝 Обрабатываем форму с кнопкой "Приложить письмо"', 'info', 'engine');
            
            // 1. Ищем кнопку "Приложить письмо"
            const attachLetterBtn = document.querySelector('[data-qa="vacancy-response-letter-toggle"]');
            if (!attachLetterBtn) {
                this.logger.log('❌ Кнопка "Приложить письмо" не найдена', 'warning', 'engine');
                return false;
            }
            
            this.logger.log('2. ✅ Найдена кнопка "Приложить письмо"', 'info', 'engine');
            
            // 2. Нажимаем на кнопку "Приложить письмо"
            attachLetterBtn.click();
            await this.delay(2000);
            
            // 3. Ищем поле для ввода письма
            const textarea = document.querySelector('textarea[name="text"]');
            if (!textarea) {
                this.logger.log('❌ Поле для письма не найдено', 'warning', 'engine');
                
                // СЦЕНАРИЙ 3: Если поле не найдено, скрываем вакансию
                this.logger.log('🔄 Активируем сценарий скрытия вакансии', 'info', 'engine');
                const hideSuccess = await this.hideVacancyAndContinue();
                return hideSuccess;
            }
            
            this.logger.log('3. ✅ Найдено поле для письма', 'info', 'engine');
            
            // 4. Заполняем поле письмом
            const letterText = this.settings.coverLetter || 'Добрый день! Заинтересовала ваша вакансия. Готов рассмотреть предложение.';
            textarea.value = letterText;
            textarea.dispatchEvent(new Event('input', { bubbles: true }));
            textarea.dispatchEvent(new Event('change', { bubbles: true }));
            await this.delay(1000);
            
            this.logger.log('4. ✅ Поле заполнено', 'info', 'engine');
            
            // 5. Ищем кнопку "Отправить"
            const sendButton = document.querySelector('[data-qa="vacancy-response-letter-submit"]');
            if (!sendButton) {
                this.logger.log('❌ Кнопка "Отправить" не найдена', 'warning', 'engine');
                return false;
            }
            
            this.logger.log('5. ✅ Найдена кнопка "Отправить"', 'info', 'engine');
            
            // 6. Нажимаем на кнопку "Отправить"
            sendButton.click();
            await this.delay(3000);
            
            this.logger.log('6. ✅ Отклик отправлен', 'success', 'engine');
            return true;
            
        } catch (error) {
            this.logger.log(`❌ Ошибка обработки формы: ${error.message}`, 'error', 'engine');
            return false;
        }
    }

    // Поиск кнопки скрытия вакансии (иконка глаза)
    async findVacancyHideButton() {
        // Ищем по различным селекторам кнопку скрытия
        const selectors = [
            '[data-qa="vacancy__blacklist-show-add_narrow-card"]', // Новая кнопка
            '[data-qa*="hide"]',
            '[data-qa*="blacklist"]',
            '.vacancy-serp-item__actions button',
            '[aria-label*="скрыть"]',
            '[aria-label*="hide"]',
            'button svg[viewBox="0 0 24 24"]'
        ];
        
        for (const selector of selectors) {
            const elements = document.querySelectorAll(selector);
            for (const element of elements) {
                // Проверяем, содержит ли элемент SVG с иконкой глаза
                const svg = element.querySelector('svg');
                if (svg) {
                    const paths = svg.querySelectorAll('path');
                    for (const path of paths) {
                        const d = path.getAttribute('d') || '';
                        // Проверяем по характерным частям path иконки глаза
                        if (d.includes('M5.06195 15.3444') || d.includes('M12 18.2') || d.includes('M12 4C6 4') || d.includes('M9.8 12')) {
                            this.logger.log(`✅ Найдена кнопка скрытия по селектору: ${selector}`, 'info', 'engine');
                            return element;
                        }
                    }
                }
            }
        }
        
        // Альтернативный поиск: ищем кнопку рядом с кнопкой отклика
        const respondButton = document.querySelector('[data-qa="vacancy-serp__vacancy_response"]');
        if (respondButton) {
            const vacancyItem = respondButton.closest('[data-qa="vacancy-serp__vacancy"]');
            if (vacancyItem) {
                // Ищем все кнопки в карточке вакансии
                const buttons = vacancyItem.querySelectorAll('button');
                for (const button of buttons) {
                    if (button !== respondButton) {
                        // Проверяем есть ли в кнопке SVG
                        const svg = button.querySelector('svg');
                        if (svg) {
                            this.logger.log('✅ Найдена кнопка в карточке вакансии', 'info', 'engine');
                            return button;
                        }
                    }
                }
            }
        }
        
        this.logger.log('❌ Кнопка скрытия не найдена', 'warning', 'engine');
        return null;
    }

    // НОВЫЙ МЕТОД: Скрытие вакансии и продолжение
    async hideVacancyAndContinue() {
        try {
            this.logger.log('👻 Начинаем процесс скрытия вакансии', 'info', 'engine');
            
            // 1. Возвращаемся на предыдущую страницу (список вакансий)
            this.logger.log('1. ↩️ Возвращаемся на список вакансий', 'info', 'engine');
            window.history.back();
            await this.delay(2000);
            
            // 2. Ищем и нажимаем на кнопку с иконкой глаза
            this.logger.log('2. 🔍 Ищем кнопку скрытия вакансии', 'info', 'engine');
            const hideButton = await this.findVacancyHideButton();
            if (!hideButton) {
                this.logger.log('❌ Кнопка скрытия вакансии не найдена', 'warning', 'engine');
                return false;
            }
            
            this.logger.log('3. ✅ Найдена кнопка скрытия, нажимаем', 'info', 'engine');
            hideButton.click();
            await this.delay(1500);
            
            // 3. Ищем и нажимаем "Скрыть эту вакансию" в выпадающем меню
            this.logger.log('4. 🔍 Ищем кнопку "Скрыть эту вакансию" в меню', 'info', 'engine');
            const hideConfirmButton = document.querySelector('[data-qa="vacancy__blacklist-menu-add-vacancy"]');
            if (!hideConfirmButton) {
                this.logger.log('❌ Кнопка "Скрыть эту вакансию" не найдена', 'warning', 'engine');
                return false;
            }
            
            this.logger.log('5. ✅ Найдена кнопка скрытия, нажимаем', 'info', 'engine');
            hideConfirmButton.click();
            await this.delay(2000);
            
            // 4. Обновляем страницу
            this.logger.log('6. 🔄 Обновляем страницу после скрытия', 'info', 'engine');
            window.location.reload();
            await this.delay(3000);
            
            this.logger.log('✅ Вакансия скрыта, продолжаем', 'success', 'engine');
            return true;
            
        } catch (error) {
            this.logger.log(`❌ Ошибка скрытия вакансии: ${error.message}`, 'error', 'engine');
            return false;
        }
    }

    async waitForPageLoad() {
        return new Promise((resolve) => {
            if (document.readyState === 'complete') {
                resolve();
            } else {
                window.addEventListener('load', resolve);
                // Таймаут на случай если событие load не сработает
                setTimeout(resolve, 5000);
            }
        });
    }

    updateProgress() {
        chrome.runtime.sendMessage({
            action: 'responseProgress',
            data: {
                count: this.responseCount,
                maxResponses: this.maxResponses,
                isRunning: this.isRunning
            }
        }).catch(error => {
            // Игнорируем ошибки когда side panel закрыт
            console.log('Не удалось отправить прогресс в side panel:', error);
        });
    }

    delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

// Инициализация движка
if (window.hhResponderLogger) {
    window.responseEngine = new ResponseEngine();
} else {
    console.log('HH Auto Responder: Логгер не найден');
}