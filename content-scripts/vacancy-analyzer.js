class VacancyAnalyzer {
    constructor() {
        this.logger = window.hhResponderLogger;
        this.initializeAnalyzer();
    }

    initializeAnalyzer() {
        this.logger.log('Анализатор вакансий инициализирован', 'info', 'analyzer');
    }

    // Анализ страницы поиска
    analyzeSearchPage() {
        const vacancies = this.extractVacancies();
        const stats = {
            total: vacancies.length,
            withTests: 0,
            requiresCoverLetter: 0,
            highSalary: 0,
            suitable: 0
        };

        vacancies.forEach(vacancy => {
            if (vacancy.hasTest) stats.withTests++;
            if (vacancy.requiresCoverLetter) stats.requiresCoverLetter++;
            if (vacancy.salary > 50000) stats.highSalary++;
            if (this.isSuitableVacancy(vacancy)) stats.suitable++;
        });

        this.logger.log(`📊 Проанализировано вакансий: ${stats.total}`, 'info', 'analyzer');
        this.logger.log(`🎯 Подходящих: ${stats.suitable}`, 'info', 'analyzer');
        this.logger.log(`⚠️ С тестами: ${stats.withTests}`, 'info', 'analyzer');

        return { vacancies, stats };
    }

    // Извлечение данных вакансий со страницы
    extractVacancies() {
        const vacancies = [];
        
        // Селекторы для HH.ru (могут потребовать адаптации)
        const vacancyCards = document.querySelectorAll('[data-qa="vacancy-serp__vacancy"]');
        
        vacancyCards.forEach((card, index) => {
            try {
                const vacancy = this.parseVacancyCard(card, index);
                if (vacancy) {
                    vacancies.push(vacancy);
                }
            } catch (error) {
                this.logger.log(`Ошибка парсинга вакансии ${index}: ${error.message}`, 'error', 'analyzer');
            }
        });

        return vacancies;
    }

    parseVacancyCard(card, index) {
        // Базовые данные вакансии
        const titleElem = card.querySelector('[data-qa="serp-item__title"]');
        const salaryElem = card.querySelector('[data-qa="vacancy-serp__vacancy-compensation"]');
        const companyElem = card.querySelector('[data-qa="vacancy-serp__vacancy-employer"]');
        const respondBtn = card.querySelector('[data-qa="vacancy-serp__vacancy_response"]');
        
        if (!titleElem || !respondBtn) return null;

        const vacancy = {
            id: `vacancy_${index}_${Date.now()}`,
            title: titleElem.textContent?.trim() || 'Неизвестно',
            salary: this.parseSalary(salaryElem?.textContent),
            company: companyElem?.textContent?.trim() || 'Неизвестно',
            element: respondBtn,
            hasTest: this.checkHasTest(card),
            requiresCoverLetter: this.checkRequiresCoverLetter(card),
            isResponded: this.checkIsResponded(card),
            url: titleElem.href
        };

        return vacancy;
    }

    parseSalary(salaryText) {
        if (!salaryText) return 0;
        
        // Парсим зарплату вида "от 100 000 руб." или "100 000 - 150 000 руб."
        const numbers = salaryText.match(/\d+/g);
        if (!numbers) return 0;
        
        // Берем первое число (минимальную зарплату)
        return parseInt(numbers[0].replace(/\s/g, '')) || 0;
    }

    checkHasTest(card) {
        // Проверяем наличие теста (иконка теста или упоминание в тексте)
        const testIndicator = card.querySelector('.vacancy-icon-test') || 
                             card.querySelector('[data-qa*="test"]');
        return !!testIndicator;
    }

    checkRequiresCoverLetter(card) {
        // Проверяем обязательность сопроводительного письма
        const description = card.textContent.toLowerCase();
        return description.includes('сопроводительное') || 
               description.includes('письмо обязательно');
    }

    checkIsResponded(card) {
        // Проверяем, был ли уже отклик на вакансию
        const respondedIndicator = card.querySelector('[data-qa*="responded"]') ||
                                  card.querySelector('.vacancy-serp__action_responded');
        return !!respondedIndicator;
    }

    // Проверка подходит ли вакансия под критерии
    isSuitableVacancy(vacancy, settings = {}) {
        const { minSalary = 0, skipTests = true } = settings;

        // Уже откликались
        if (vacancy.isResponded) {
            return false;
        }

        // Зарплата ниже минимальной
        if (vacancy.salary < minSalary) {
            return false;
        }

        // Пропускаем вакансии с тестами
        if (skipTests && vacancy.hasTest) {
            return false;
        }

        return true;
    }

    // Получение списка подходящих вакансий
    getSuitableVacancies(settings = {}) {
        const { vacancies } = this.analyzeSearchPage();
        return vacancies.filter(vacancy => this.isSuitableVacancy(vacancy, settings));
    }

    // Анализ страницы вакансии (когда открыта конкретная вакансия)
    analyzeVacancyPage() {
        const vacancyDetails = {
            hasTest: this.checkPageHasTest(),
            requiresCoverLetter: this.checkPageRequiresCoverLetter(),
            isQuickApply: this.checkIsQuickApply(),
            formSelectors: this.detectFormSelectors()
        };

        this.logger.log(`📄 Анализ страницы вакансии: ${JSON.stringify(vacancyDetails)}`, 'info', 'analyzer');
        return vacancyDetails;
    }

    checkPageHasTest() {
        return document.querySelector('[data-qa*="test"]') !== null ||
               document.textContent.includes('тестовое задание');
    }

    checkPageRequiresCoverLetter() {
        const textarea = document.querySelector('[data-qa="vacancy-response-popup-form-letter-input"]');
        return textarea && textarea.hasAttribute('required');
    }

    checkIsQuickApply() {
        // Быстрый отклик без сопроводительного
        return document.querySelector('[data-qa="vacancy-response-letter-toggle"]') !== null;
    }

    detectFormSelectors() {
        return {
            coverLetter: '[data-qa="vacancy-response-popup-form-letter-input"]',
            submitButton: '[data-qa="vacancy-response-submit-button"]',
            quickSubmit: '[data-qa="vacancy-serp__vacancy_response"]',
            testWarning: '.vacancy-test-warning'
        };
    }
}

// Инициализация анализатора
if (window.hhResponderLogger) {
    window.vacancyAnalyzer = new VacancyAnalyzer();
} else {
    console.log('HH Auto Responder: Логгер не найден, анализатор не инициализирован');
}