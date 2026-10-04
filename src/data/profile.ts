export type ProfileLink = {
	label: 'Email' | 'GitHub' | 'CV';
	href: string | null;
	external?: boolean;
};

const assetBase = import.meta.env.BASE_URL.endsWith('/')
	? import.meta.env.BASE_URL
	: `${import.meta.env.BASE_URL}/`;

export const profile = {
	name: 'Hexin Chen',
	initials: 'HC',
	university: 'Tsinghua University',
	program: 'Mathematics & Physics × Software Engineering',
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
} as const;

export const courseworkGroups = [
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
] as const;

export const awards = [
	'Academic Excellence Scholarship',
	'Merit Scholarship',
	'MCM/ICM Successful Participant (S Award)',
	'Silver Award, Tsinghua Summer Social Practice Team (Team Captain)',
] as const;

export const navigation = [
	{ label: 'Work', href: '#work' },
	{ label: 'Education', href: '#education' },
	{ label: 'Awards', href: '#awards' },
	{ label: 'Contact', href: '#contact' },
] as const;

export const siteMetadata = {
	title: 'Hexin Chen | Quantitative Modeling, Machine Learning & Research',
	description:
		'Hexin Chen studies Mathematics & Physics and Software Engineering at Tsinghua University, with work in neural audio representation, statistical modeling, signal processing, and real-time sensing systems.',
} as const;
