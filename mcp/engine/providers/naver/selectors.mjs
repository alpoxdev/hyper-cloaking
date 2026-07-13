/**
 * Centralized Naver DOM selectors; action code should fail closed when these
 * selectors drift or no longer produce the expected page signals.
 */

/**
 * Version identifier for the Naver selector contract.
 */
export const NAVER_SELECTORS_VERSION = '2026-07-11';

/**
 * Selector contract for Naver search, blog, and cafe surfaces.
 *
 * Consumers use these selectors to locate content, controls, and empty states;
 * changes should be accompanied by a selector version update.
 */
export const naverSelectors = {
  search: {
    web: {
      link: 'ul.lst_total a.link_tit, li.bx a.link_tit, #main_pack a.total_tit',
      emptyState: '.not_found, [class*="noresult"]'
    },
    blog: {
      link: 'a.title_link, a.api_txt_lines.total_tit',
      emptyState: '.not_found, [class*="noresult"]'
    },
    cafe: {
      link: 'a.title_link, a.api_txt_lines.total_tit',
      emptyState: '.not_found, [class*="noresult"]'
    }
  },
  blog: {
    postTitle: '.se-title-text, #title_1',
    postBody: '.se-main-container, #postViewArea',
    author: '.nick, .writer_info a',
    timestamp: '.se_publishDate, .date',
    commentCount: '.item_reply_count, .u_cnt._count',
    commentText: '.u_cbox_contents',
    commentEmptyState: '.u_cbox_no_data',
    like: 'a.u_likeit_list_btn:not(.on)',
    unlike: 'a.u_likeit_list_btn.on',
    commentField: '.u_cbox_text',
    commentSubmit: '.u_cbox_btn_upload',
    replyControl: '.u_cbox_btn_reply',
    listItem: 'a.link_post, .post_item a[href*="/PostView"]',
    listEmptyState: '.list_none, [class*="noresult"]',
    write: {
      titleField: '.se-title-input, #title',
      bodyField: '.se-content, #postAreaBox',
      visibilitySelect: '.se-publish-select, select[name="open_type"]',
      fileInput: 'input[type="file"]',
      saveDraftButton: 'button[data-click-area="tbtn.temp"], button:has-text("임시저장")',
      publishButton: 'button[data-click-area="tbtn.write"], button:has-text("발행")',
      draftItem: '[data-draft-id]'
    }
  },
  cafe: {
    membershipBadge: '.membership_info[data-member="true"], .gm-tcarea .member_badge',
    writePermission: 'a.btn_write, button.write_btn',
    postTitle: '.title_text, .ArticleContentBox .tit-box h3',
    postBody: '.se-main-container, .ArticleContentBox .article_container',
    author: '.nickname, .writer_info a',
    timestamp: '.date, .article_info .date',
    commentText: '.comment_text_box, .text_comment',
    commentEmptyState: '.comment_empty, .empty_comment',
    like: 'a.like_btn:not(.on)',
    unlike: 'a.like_btn.on',
    commentField: '.comment_inbox_text, textarea.CommentEditor',
    commentSubmit: '.btn_register, button.BaseButton--skinGreen',
    replyControl: '.btn_reply, button.CommentItem_button_reply',
    listItem: 'a.article, .board-list a[href*="articleid"]',
    listEmptyState: '.list_none, [class*="noresult"]',
    write: {
      titleField: 'input#subject, input[name="subject"]',
      bodyField: '.se-content, #tbody',
      visibilitySelect: '.cafe-write-open select, select[name="open"]',
      fileInput: 'input[type="file"]',
      submitButton: 'a.btn_submit, button.BaseButton--skinGreen[type="submit"]',
      articleItem: '[data-article-id]'
    }
  }
};
