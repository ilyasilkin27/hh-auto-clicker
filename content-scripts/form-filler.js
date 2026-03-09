class FormFiller {
    constructor() {
        this.logger = window.hhResponderLogger;
        this.initializeFiller();
    }

    initializeFiller() {
        this.logger.log('Заполнитель форм инициализирован', 'info', 'filler');
    }

    // Заполнение сопроводительного письма
    fillCoverLetter(text) {
        const textarea = document.querySelector('[data-qa="vacancy-response-popup-form-letter-input"]');
        if (!textarea) {
            this.logger.log('❌ Поле для сопроводительного письма не найдено', 'error', 'filler');
            return false;
        }

        try {
            textarea.value = text;
            // Триггерим события для обновления состояния формы
            textarea.dispatchEvent(new Event('input', { bubbles: true }));
            textarea.dispatchEvent(new Event('change', { bubbles: true }));
            
            this.logger.log('✅ Сопроводительное письмо заполнено', 'success', 'filler');
            return true;
        } catch (error) {
            this.logger.log(`❌ Ошибка заполнения письма: ${error.message}`, 'error', 'filler');
            return false;
        }
    }

    // Заполнение дополнительных полей если есть
    fillAdditionalFields(vacancyData) {
        const fields = {
            salary: '[data-qa="vacancy-salary"]',
            experience: '[data-qa="vacancy-experience"]',
            // Добавьте другие поля по необходимости
        };

        let filledCount = 0;

        Object.entries(fields).forEach(([field, selector]) => {
            const element = document.querySelector(selector);
            if (element && vacancyData[field]) {
                element.value = vacancyData[field];
                element.dispatchEvent(new Event('input', { bubbles: true }));
                filledCount++;
            }
        });

        if (filledCount > 0) {
            this.logger.log(`✅ Заполнено дополнительных полей: ${filledCount}`, 'success', 'filler');
        }

        return filledCount;
    }

    // Отправка формы
    submitForm() {
        const submitButton = document.querySelector('[data-qa="vacancy-response-submit-button"]') ||
                           document.querySelector('button[type="submit"]') ||
                           document.querySelector('.vacancy-response-submit');
        
        if (!submitButton) {
            this.logger.log('❌ Кнопка отправки не найдена', 'error', 'filler');
            return false;
        }

        try {
            submitButton.click();
            this.logger.log('✅ Форма отправлена', 'success', 'filler');
            return true;
        } catch (error) {
            this.logger.log(`❌ Ошибка отправки формы: ${error.message}`, 'error', 'filler');
            return false;
        }
    }

    // Проверка валидности формы
    validateForm() {
        const requiredFields = document.querySelectorAll('[required]');
        let isValid = true;

        requiredFields.forEach(field => {
            if (!field.value.trim()) {
                isValid = false;
                this.logger.log(`⚠️ Обязательное поле не заполнено: ${field.name || field.getAttribute('data-qa')}`, 'warning', 'filler');
            }
        });

        return isValid;
    }

    // Обработка капчи если появится
    handleCaptcha() {
        const captchaElement = document.querySelector('.g-recaptcha') ||
                             document.querySelector('[data-qa*="captcha"]');
        
        if (captchaElement) {
            this.logger.log('🛑 Обнаружена капча, требуется ручное вмешательство', 'error', 'filler');
            return false;
        }

        return true;
    }
}

// Инициализация заполнителя
if (window.hhResponderLogger) {
    window.formFiller = new FormFiller();
} else {
    console.log('HH Auto Responder: Логгер не найден, заполнитель не инициализирован');
}