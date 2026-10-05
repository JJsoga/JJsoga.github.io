export type SiteLocale = 'en' | 'zh';

export type ProfileLink = {
	label: string;
	href: string;
	external?: boolean;
};

const assetBase = import.meta.env.BASE_URL.endsWith('/')
	? import.meta.env.BASE_URL
	: `${import.meta.env.BASE_URL}/`;

const englishHome = assetBase;
const chineseHome = `${assetBase}zh/`;
const chineseCv = `${assetBase}${encodeURIComponent('zh简历.pdf')}`;

export const profileContentByLocale = {
	en: {
		documentLang: 'en',
		locale: 'en' as const,
		homeHref: englishHome,
		languageSwitch: {
			href: chineseHome,
			label: 'Switch to Chinese',
			shortLabel: '中文',
			hreflang: 'zh-CN',
			lang: 'zh-CN',
		},
		profile: {
			name: 'Hexin Chen',
			initials: 'HC',
			university: 'Tsinghua University',
			program: 'Mathematics & Physics × Software Engineering',
			headline: 'Mathematics & Physics × Software Engineering at Tsinghua University',
			bio:
				'My work spans machine learning, statistical modeling, signal processing, and software systems, with projects in neural audio representation and real-world sensing. I am currently exploring quantitative research and statistical learning.',
			education: {
				period: '2024–2028',
				gpa: 'GPA 3.8 / 4.0',
				rank: 'Top 15%',
			},
			links: [
				{ label: 'Email', href: 'mailto:hx-chen24@mails.tsinghua.edu.cn' },
				{ label: 'GitHub', href: 'https://github.com/JJsoga', external: true },
				{ label: 'CV', href: `${assetBase}Hexin.pdf`, external: true },
			] satisfies ProfileLink[],
		},
		courseworkGroups: [
			{
				label: 'Mathematics & Statistics',
				courses: ['Linear Algebra', 'Calculus', 'Probability & Stochastic Processes', 'Discrete Mathematics'],
			},
			{
				label: 'Systems & Software',
				courses: ['Computer Organization', 'Database Systems', 'Software Engineering'],
			},
			{
				label: 'Supporting Science',
				courses: ['Physics'],
			},
		],
		awards: [
			'Academic Excellence Scholarship',
			'Merit Scholarship',
			'MCM/ICM Successful Participant (S Award)',
			'Silver Award, Tsinghua Summer Social Practice Team (Team Captain)',
		],
		navigation: [
			{ label: 'Work', href: '#work' },
			{ label: 'Education', href: '#education' },
			{ label: 'Awards', href: '#awards' },
			{ label: 'Contact', href: '#contact' },
		],
		metadata: {
			title: 'Hexin Chen | Quantitative Modeling, Machine Learning & Research',
			description:
				'Hexin Chen studies Mathematics & Physics and Software Engineering at Tsinghua University, with work in neural audio representation, statistical modeling, signal processing, and real-time sensing systems.',
			socialImageAlt: 'Hexin Chen — Machine Learning, Statistical Modeling, and Software Systems',
		},
		labels: {
			skipLink: 'Skip to content',
			brandAria: 'Hexin Chen — back to top',
			navigationAria: 'Primary navigation',
			academicStandingAria: 'Academic standing',
			profileLinksAria: 'Profile links',
			scrollCue: 'Selected work',
			workSection: '01 / Selected Work',
			educationSection: '02 / Education & Coursework',
			academicStanding: 'Academic standing',
			selectedCoursework: 'Selected coursework',
			awardsSection: '03 / Awards',
			contactSection: '04 / Contact',
			contactCopy:
				'I welcome conversations about quantitative research, machine learning, statistical modeling, and data-driven systems.',
			contactLinksAria: 'Contact links',
			backToTop: 'Back to top',
			primaryProject: 'Primary project',
			projectTopics: 'topics',
		},
	},
	zh: {
		documentLang: 'zh-CN',
		locale: 'zh' as const,
		homeHref: chineseHome,
		languageSwitch: {
			href: englishHome,
			label: '切换至英文',
			shortLabel: 'EN',
			hreflang: 'en',
			lang: 'en',
		},
		profile: {
			name: '陈鹤鑫',
			initials: 'HC',
			university: '清华大学',
			program: '数理基础科学 × 软件工程',
			headline: '清华大学 · 数理基础科学 × 软件工程',
			bio:
				'我的工作涵盖机器学习、统计建模、信号处理与软件系统，项目聚焦神经音频表征和真实场景感知。目前正在探索量化研究与统计学习。',
			education: {
				period: '2024–2028',
				gpa: 'GPA 3.8 / 4.0',
				rank: '前 15%',
			},
			links: [
				{ label: '邮箱', href: 'mailto:hx-chen24@mails.tsinghua.edu.cn' },
				{ label: 'GitHub', href: 'https://github.com/JJsoga', external: true },
				{ label: '中文简历', href: chineseCv, external: true },
			] satisfies ProfileLink[],
		},
		courseworkGroups: [
			{
				label: '数学与统计',
				courses: ['线性代数', '微积分', '概率论与随机过程', '离散数学'],
			},
			{
				label: '计算机系统与软件',
				courses: ['计算机组成原理', '数据库原理', '软件工程'],
			},
			{
				label: '基础科学',
				courses: ['基础物理学'],
			},
		],
		awards: [
			'学业优秀奖学金',
			'综合优秀奖学金',
			'美国大学生数学建模竞赛 S 奖',
			'清华大学暑期社会实践支队银奖（支队长）',
		],
		navigation: [
			{ label: '研究项目', href: '#work' },
			{ label: '教育背景', href: '#education' },
			{ label: '荣誉奖项', href: '#awards' },
			{ label: '联系', href: '#contact' },
		],
		metadata: {
			title: '陈鹤鑫 | 量化建模、机器学习与研究',
			description:
				'陈鹤鑫就读于清华大学数理基础科学与软件工程专业，研究方向包括神经音频表征、统计建模、信号处理与实时感知系统。',
			socialImageAlt: '陈鹤鑫 — 机器学习、统计建模与软件系统',
		},
		labels: {
			skipLink: '跳转到主要内容',
			brandAria: '陈鹤鑫 — 返回顶部',
			navigationAria: '主导航',
			academicStandingAria: '学业表现',
			profileLinksAria: '个人链接',
			scrollCue: '代表性项目',
			workSection: '01 / 代表性项目',
			educationSection: '02 / 教育背景与课程',
			academicStanding: '学业表现',
			selectedCoursework: '核心课程',
			awardsSection: '03 / 荣誉奖项',
			contactSection: '04 / 联系',
			contactCopy: '欢迎交流量化研究、机器学习、统计建模与数据驱动系统相关问题。',
			contactLinksAria: '联系方式',
			backToTop: '返回顶部',
			primaryProject: '重点项目',
			projectTopics: '相关主题',
		},
	},
} as const;

export type ProfileContent = (typeof profileContentByLocale)[SiteLocale];
