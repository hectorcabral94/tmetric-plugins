﻿class PopupController {

    constructor() {

        this.initControls();
        this.switchState(this._states.loading);
        this.initializeAction().then(data => {
            this.setData(data);

            if (this.isLongRunning(data.timer.startTime)) {
                this.fillFixForm(data.timer);
                this.switchState(this._states.fixing);
            } else if (data.issue == null && data.timer && data.timer.isStarted) {
                this.fillViewForm(data.timer);
                this.fillCreateForm(data.title);
                this.switchState(this._states.viewing);
            } else {
                this.fillCreateForm((data.issue && data.issue.issueName) || data.title);
                this.switchState(this._states.creating);
            }
        }).catch(error => {
            this.isConnectionRetryEnabledAction().then(retrying => {
                if (retrying) {
                    this.switchState(this._states.retrying);
                } else {
                    this.switchState(this._states.authenticating);
                }
            });
        });
    }

    private _activeTimer: Models.Timer;
    private _issue: WebToolIssueTimer;
    private _timeFormat: string;
    private _projects: Models.ProjectLite[];
    private _tags: Models.Tag[];
    private _constants: Models.Constants;
    private _canCreateProjects: boolean;
    private _canCreateTags: boolean;

    callBackground(request: IPopupRequest): Promise<IPopupResponse> {
        return new Promise((resolve, reject) => {
            chrome.runtime.sendMessage(request, (response: IPopupResponse) => {
                resolve(response);
            });
        });
    }

    close() {
        window.close();
    }

    setData(data: IPopupInitData) {
        if (data.timer) {
            this._activeTimer = data.timer;
            this._issue = data.issue;
            this._timeFormat = data.timeFormat;
            this._projects = data.projects;
            this._tags = data.tags.filter(tag => !!tag).sort((a, b) => this.compare(a, b));
            this._constants = data.constants;
            this._canCreateProjects = data.canCreateProjects;
            this._canCreateTags = data.canCreateTags;
        } else {
            this.close();
        }
    }

    putTimer(timer: WebToolIssueTimer) {
        this.putTimerAction(timer);
        this.close();
    }

    private compare(t1: Models.Tag, t2: Models.Tag): number {

        function compareByName(a: string, b: string) {
            let aLower = a.toLowerCase();
            let bLower = b.toLowerCase();
            if (aLower < bLower) return -1;
            if (aLower > bLower) return 1;
            return 0;
        }

        // sorting by type, from tag to worktype
        let direction = -1;
        let nameDiff = compareByName(t1.tagName, t2.tagName);
        let typeDiff = (t1.isWorkType ? 0 : direction) - (t2.isWorkType ? 0 : direction);

        return typeDiff || nameDiff;
    }

    // actions

    protected wrapBackgroundAction<TData, TResult>(action: string) {
        return (data?: TData) => {
            return new Promise<TResult>((resolve, reject) => {
                this.callBackground({
                    action: action,
                    data: data
                }).then(response => {
                    if (response.error) {
                        reject(response.error);
                    } else {
                        resolve(response.data);
                    }
                }).catch(error => {
                    reject(<string>error);
                });
            })
        };
    }

    initializeAction = this.wrapBackgroundAction<void, IPopupInitData>('initialize');
    openTrackerAction = this.wrapBackgroundAction<void, void>('openTracker');
    openPageAction = this.wrapBackgroundAction<string, void>('openPage');
    loginAction = this.wrapBackgroundAction<void, void>('login');
    isConnectionRetryEnabledAction = this.wrapBackgroundAction<void, boolean>('isConnectionRetryEnabled');
    retryAction = this.wrapBackgroundAction<void, void>('retry');
    fixTimerAction = this.wrapBackgroundAction<void, void>('fixTimer');
    putTimerAction = this.wrapBackgroundAction<WebToolIssueTimer, void>('putTimer');

    // ui mutations

    private _forms = {
        login: '#login-form',
        fix: '#fix-form',
        view: '#view-form',
        create: '#create-form'
    };

    private _messageTypes = {
        error: 'error',
        warning: 'warning',
        info: 'info'
    };

    private _states = {
        loading: 'loading',
        retrying: 'retrying',
        authenticating: 'authenticating',
        fixing: 'fixing',
        creating: 'creating',
        viewing: 'viewing'
    };

    switchState(name: string) {
        $('content').attr('class', name);
        if (name == this._states.creating) {
            this.initCreatingForm();
        }
    }

    fillFixForm(timer: Models.Timer) {
        if (timer && timer.details) {
            $(this._forms.fix + ' .description').text(this.toDescription(timer.details.description));
            $(this._forms.fix + ' .startTime').text(this.toLongRunningDurationString(timer.startTime));
        }
    }

    fillViewForm(timer: Models.Timer) {

        let details = timer && timer.details;
        if (!details) {
            return
        }

        $(this._forms.view + ' .time').text(this.toDurationString(timer.startTime));

        let url = this.getTaskUrl(details);
        if (url && details.projectTask && details.projectTask.externalIssueId) {
            let issueIdText = '\u29C9'; // "Two joined squares" symbol
            if (details.projectTask.showIssueId) {
                issueIdText = details.projectTask.externalIssueId;
            }
            $(this._forms.view + ' .task .id .link').attr('href', url).text(issueIdText);
        } else {
            $(this._forms.view + ' .task .id').hide();
        }

        $(this._forms.view + ' .task .name').text(this.toDescription(details.description));

        let projectName = this.toProjectName(details.projectId);

        if (projectName) {
            $(this._forms.view + ' .project .name').text(projectName).show();
        } else {
            $(this._forms.view + ' .project').hide();
        }

        if (timer.tagsIdentifiers && timer.tagsIdentifiers.length) {
            $(this._forms.view + ' .tags .items').text(this.makeTimerTagsText(timer.tagsIdentifiers)).show();
        } else {
            $(this._forms.view + ' .tags').hide();
        }
    }

    fillCreateForm(description: string) {
        $(this._forms.create + ' .task .input').val(description).focus().select();
        this.initProjectSelector(this._forms.create + ' .project .input', this.makeProjectItems());
        this.initTagSelector(this._forms.create + ' .tags .input', this.makeTagItems(), this.makeTagSelectedItems(), this._canCreateTags);
        if (description) {
            setTimeout(() => {
                $(this._forms.create + ' .project .input').select2('focus');
            });
        }
    }

    initCreatingForm() {
        $(this._forms.create + ' .task .input').focus().select();
    }

    getTaskUrl(details: Models.TimeEntryDetail) {
        let task = details && details.projectTask;
        if (task && task.integrationUrl && task.relativeIssueUrl) {
            return task.integrationUrl + task.relativeIssueUrl;
        }
        return '';
    }

    private _weekdaysShort = 'Sun_Mon_Tue_Wed_Thu_Fri_Sat'.split('_');
    private _monthsShort = 'Jan_Feb_Mar_Apr_May_Jun_Jul_Aug_Sep_Oct_Nov_Dec'.split('_');

    getDuration(startTime: Date | string) {
        let startDate = startTime instanceof Date ? startTime : new Date(<string>startTime);
        let result = new Date().getTime() - startDate.getTime();
        return result > 0 ? result : 0;
    }

    toDurationString(startTime: string) {

        const MINUTE = 1000 * 60;
        const HOUR = MINUTE * 60;

        let duration = this.getDuration(startTime);
        let hours = Math.floor(duration / HOUR);
        let minutes = Math.floor((duration - hours * HOUR) / MINUTE);

        let result = [];
        if (hours) {
            result.push(hours + ' h');
        }
        result.push(minutes + ' min');

        return result.join(' ');
    }

    isLongRunning(startTime: string) {

        const HOUR = 1000 * 60 * 60;
        const LONG_RUNNING_DURATION = this._constants.maxTimerHours * HOUR;

        let duration = this.getDuration(startTime);

        return duration >= LONG_RUNNING_DURATION;
    }

    toLongRunningDurationString(startTime: string) {

        let duration = this.getDuration(startTime);

        let now = new Date();

        let durationToday = this.getDuration(new Date(now.getFullYear(), now.getMonth(), now.getDate()));
        let durationYesterday = this.getDuration(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1));

        let startDate = new Date(startTime);

        // Output:
        // Started Wed, 03 Feb at 15:31
        let result = '';
        if (duration <= durationToday) {
            result = 'Started today';
        } else if (duration <= durationYesterday) {
            result = 'Started yesterday';
        } else {
            result = 'Started ' + this._weekdaysShort[startDate.getDay()] + ', ' + startDate.getDate() + ' ' + this._monthsShort[startDate.getMonth()];
        }

        let hours = startDate.getHours();
        let minutes = startDate.getMinutes();

        if (this._timeFormat == 'H:mm') {
            result += ' at ' + hours + ':' + (minutes < 10 ? '0' + minutes : minutes);
        } else {
            let period: string;
            if (hours >= 12) {
                period = 'pm';
                hours -= 12;
            } else {
                period = 'am';
            }
            result += ' at ' + (hours == 0 ? 12 : hours) + ':' + (minutes < 10 ? '0' + minutes : minutes) + ' ' + period;
        }

        return result;
    }

    toDescription(description: string) {
        return description || '(No description)';
    }

    toProjectName(projectId: number): string {
        if (projectId && this._projects) {
            let projects = this._projects.filter(_ => _.projectId === projectId);
            if (projects.length) {
                return projects[0].projectName;
            }
        }
        return '';
    }

    getProject(id: number): Models.ProjectLite {
        let project = null;
        if (this._projects) {
            let projects = this._projects.filter(project => project.projectId === id);
            if (projects.length) {
                project = projects[0];
            }
        }
        return project;
    }

    getTag(id: number): Models.Tag {
        if (this._tags) {
            let tags = this._tags.filter(tag => tag.tagId === id);
            if (tags.length) {
                return tags[0];
            }
        }
        return null;
    }

    makeTimerTagsText(timerTags: number[]) {
        return timerTags.map(id => this.getTag(id))
            .filter(tag => !!tag)
            .sort(this.compare)
            .map(tag => tag.tagName)
            .join(', ');
    }

    private _selectProjectOption: IdTextAvatar = { id: 0, text: 'No project', avatar: null };

    private _createNewProjectOption: IdTextAvatar = { id: -1, text: 'New project', avatar: null };

    makeProjectItems() {
        let projects = <IdTextAvatar[]>[];
        if (this._canCreateProjects) {
            projects.push(this._createNewProjectOption);
        }
        projects.push(this._selectProjectOption);
        return projects.concat(this._projects.map(project => {
            return <IdTextAvatar>{ id: project.projectId, text: project.projectName, avatar: project.avatar };
        }));
    }

    makeTagItems() {

        let existingItems = <{ [name: string]: boolean }>{};

        let items = this._tags.map(tag => {
            let name = tag.tagName;
            existingItems[name.toLowerCase()] = true;
            return <IdTextTagType>{ id: name, text: name, isWorkType: tag.isWorkType };
        });

        let isWorkTypeMap: { [name: string]: boolean } = {};
        this._tags.forEach(tag => {
            isWorkTypeMap[tag.tagName.toLowerCase()] = tag.isWorkType;
        });

        if (this._canCreateTags && this._issue && this._issue.tagNames) {
            this._issue.tagNames.forEach(name => {
                let isWorkType = isWorkTypeMap[name.toLowerCase()]
                if (!existingItems[name.toLowerCase()]) {
                    items.push(<IdTextTagType>{ id: name, text: name, isWorkType });
                }
            });
        }

        return items;
    }

    makeTagSelectedItems() {
        return (this._issue && this._issue.tagNames) || [];
    }

    getSelectValue(selector: string) {
        return $(selector).select().val();
    }

    initProjectSelector(selector: string, items: IdTextPair[]) {
        $(selector).select2({
            data: items,
            templateSelection: this.formatSelectedProject.bind(this),
            templateResult: this.formatProjectItem.bind(this)
        }).val(this._selectProjectOption.id).trigger('change');
    }

    private formatProjectItem(data: IProjectSelection) {
        let html = '<span>';
        let text = this.escape(data.text);

        if (Number(data.id) != 0 && Number(data.id) != -1) {
            html += (!!data.avatar
                ? `<img class="project-avatar-image" src="${this._constants.serviceUrl}/${data.avatar}" />`
                : '<img class="project-avatar-image" src="../images/project.png" />');
        }

        html += (Number(data.id) == -1
            ? '<strong>' + this.escape(text) + '</strong>'
            : this.escape(text));

        html += '</span>';

        return $(html);
    }

    private formatSelectedProject(data: IProjectSelection) {
        let html = '<span ';
        let text = this.escape(data.text);

        if (Number(data.id) == 0) {
            html += 'class="mute-text"';
            text = 'Select project';
        }

        html += '>'

        if (Number(data.id) != 0 && Number(data.id) != -1) {
            html += (!!data.avatar
                ? `<img class="project-avatar-image" src="${this._constants.serviceUrl}/${data.avatar}" />`
                : '<img class="project-avatar-image" src="../images/project.png" />');
        }

        html += text + '</span>'

        return $(html);
    }

    private escape(str: string) {
        let escapeMap = {
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#x27;',
            '`': '&#x60;'
        };
        let htmlEscaper = /[&<>`"'\/]/g;
        return ('' + str).replace(htmlEscaper, _ => htmlEscaper[_]);
    }

    initTagSelector(selector: string, items: IdTextPair[], selectedItems: string[], allowNewItems?: boolean) {
        $(selector).select2({
            data: items,
            tags: allowNewItems,
            templateResult: this.formatTagItem.bind(this)
        }).val(selectedItems).trigger('change');
    }

    private formatTagItem(data: ITagSelection) {
        let text = $('<span>').text(data.text).html();
        let html = '<span><i class="tag-icon fa ';

        data.isWorkType
            ? html += 'fa-worktype'
            : html += 'fa-tag';

        html += '"></i>' + text + '</span>';

        return $(html);
    }

    // ui event handlers

    initControls() {

        $('#site-link').click(() => (this.onSiteLinkClick(), false));
        $('#task-link').click(() => (this.onTaskLinkClick(), false));
        $('#login').click(() => (this.onLoginClick(), false));
        $('#retry').click(() => (this.onRetryClick(), false));
        $('#fix').click(() => (this.onFixClick(), false));
        $('#start').click(() => (this.onStartClick(), false));
        $('#stop').click(() => (this.onStopClick(), false));
        $('#create-link').click(() => (this.onCreateClick(), false));
        $(this._forms.create + ' .project .input').change(this.onProjectSelectChange());
        $('.cancel-btn').click(() => (this.onCancelClick(), false));

        // close popup when escape key pressed and no selectors are opened
        window.addEventListener('keydown', event => {
            if (event.keyCode == 27) {
                if (!$('body > .select2-container').length) {
                    this.close();
                }
            }
        }, true);
    }

    private onCancelClick() {
        this.close();
    }

    private onProjectSelectChange() {
        const $divNewProject = $(this._forms.create + ' .new-project');
        const $inputNewProject = $(this._forms.create + ' .new-project .input');
        const self = this;

        return function () {
            if ($(this).val() == -1) { // create new project option
                let issueProjectName = (self._issue && self._issue.projectName) || '';
                $inputNewProject.val(issueProjectName);
                $divNewProject.css('display', 'block');
            } else {
                $divNewProject.css('display', 'none');
            }
        }
    }

    private onSiteLinkClick() {
        this.openTrackerAction();
        this.close();
    }

    private onTaskLinkClick() {
        let url = this.getTaskUrl(this._activeTimer.details);
        if (url) {
            this.openPageAction(url);
            this.close();
        }
    }

    private onLoginClick() {
        this.loginAction();
        this.close();
    }

    private onRetryClick() {
        this.retryAction();
        this.close();
    }

    private onFixClick() {
        this.fixTimerAction();
        this.close();
    }

    private onStartClick() {

        let timer = <WebToolIssueTimer>{};
        timer.isStarted = true;
        timer.description = $(this._forms.create + ' .task .input').val();
        let selectedProject = $(this._forms.create + ' .project .input').select2('data');
        let isSelected = selectedProject[0] && selectedProject[0].selected && (selectedProject[0].id != 0);
        timer.projectName = isSelected ? selectedProject[0].text : '';
        if (isSelected && selectedProject[0].id == -1) {
            timer.projectName = $.trim($(this._forms.create + ' .new-project .input').val());
        }
        timer.tagNames = this.getSelectValue(this._forms.create + ' .tags .input') || [];

        if (this._issue) {
            let issue = this._issue;
            timer.issueName = this._issue.issueName;
            timer.issueId = issue.issueId;
            timer.issueUrl = issue.issueUrl;
            timer.serviceUrl = issue.serviceUrl;
            timer.serviceType = issue.serviceType;
            timer.showIssueId = issue.showIssueId;
        }

        this.putTimer(timer);
    }

    private onStopClick() {
        this.putTimer(<WebToolIssueTimer>{ isStarted: false });
    }

    private onCreateClick() {
        this.switchState(this._states.creating);
    }
}

interface IProjectSelection extends Select2SelectionObject {
    avatar: string;
}

interface IdTextAvatar extends IdTextPair {
    avatar: string;
}

interface ITagSelection extends Select2SelectionObject {
    isWorkType: boolean;
}

interface IdTextTagType extends IdTextPair {
    isWorkType: boolean;
}