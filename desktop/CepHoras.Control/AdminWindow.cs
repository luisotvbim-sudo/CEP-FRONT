using System.Diagnostics;
using System.Windows;
using System.Windows.Controls;
using CepHoras.Control.Protocol;

namespace CepHoras.Control;

internal sealed class AdminWindow : Window
{
    private readonly PasswordBox password = new() { Padding = new Thickness(8), MaxLength = 128 };
    private readonly PasswordBox confirmation = new() { Padding = new Thickness(8), MaxLength = 128 };
    private readonly TextBlock status = new() { TextWrapping = TextWrapping.Wrap, Margin = new Thickness(0, 16, 0, 0) };
    internal AdminWindow()
    {
        Title = "CEP Horas — configuração administrativa (piloto)"; Width = 610; SizeToContent = SizeToContent.Height;
        ResizeMode = ResizeMode.NoResize; WindowStartupLocation = WindowStartupLocation.CenterScreen;
        var panel = new StackPanel { Margin = new Thickness(28) }; Content = panel;
        panel.Children.Add(new TextBlock { Text = "Controle local de desligamento", FontSize = 24, FontWeight = FontWeights.SemiBold });
        panel.Children.Add(new TextBlock { Margin = new Thickness(0, 16, 0, 16), TextWrapping = TextWrapping.Wrap,
            Text = "PILOTO: a TI define uma senha temporária. A regra de divergência de horas ainda NÃO está integrada. O serviço valida a senha e pode desligar este computador após confirmação no CEP Horas.\n\nAo ativar: usuários comuns perdem os direitos de desligar/reiniciar local e remotamente; comandos de energia são ocultados; desligar sem login é desabilitado; o botão físico de toque curto recebe a política Não fazer nada. Administradores mantêm o direito e esta ferramenta de recuperação.\n\nSalve o trabalho e feche todas as versões do CEP Horas. Faça novo logon de todos os usuários após ativar/restaurar. Políticas do domínio podem sobrescrever estas alterações." });
        panel.Children.Add(new TextBlock { Text = "Senha temporária definida pela TI (mínimo 8 caracteres)" }); panel.Children.Add(password);
        panel.Children.Add(new TextBlock { Text = "Confirme a senha", Margin = new Thickness(0, 10, 0, 0) }); panel.Children.Add(confirmation);
        var consent = new CheckBox { Content = "Revisei o escopo e vou testar primeiro neste computador.", Margin = new Thickness(0, 16, 0, 16) }; panel.Children.Add(consent);
        var activate = new Button { Content = "Ativar restrição local", Padding = new Thickness(12, 9, 12, 9), IsEnabled = false };
        consent.Checked += (_, _) => activate.IsEnabled = true; consent.Unchecked += (_, _) => activate.IsEnabled = false;
        activate.Click += async (_, _) =>
        {
            activate.IsEnabled = false;
            try
            {
                if (Process.GetProcessesByName("CepHoras").Length != 0) throw new InvalidOperationException("Feche todas as versões do CEP Horas pela bandeja antes de ativar.");
                var confirmedPassword = password.Password;
                if (confirmedPassword != confirmation.Password) throw new InvalidOperationException("As senhas não conferem.");
                var service = await ControlClient.Send(new ControlRequest("status"));
                if (service.Code != "inactive") throw new InvalidOperationException("O serviço já está configurado ou requer recuperação: " + service.Message);
                PolicyStore.Apply(confirmedPassword);
                status.Text = "ATIVADO. Saia da sessão do Windows e entre novamente para renovar os privilégios. Teste com um usuário comum. Abra CEP Horas (Corporativo) pelo menu Iniciar. A TI pode restaurar abaixo.";
            }
            catch (Exception error) { status.Text = "Não foi possível ativar: " + error.Message; }
            finally { password.Clear(); confirmation.Clear(); activate.IsEnabled = consent.IsChecked == true; }
        };
        panel.Children.Add(activate);
        var restore = new Button { Content = "Restaurar configurações anteriores (TI)", Padding = new Thickness(12, 9, 12, 9), Margin = new Thickness(0, 10, 0, 0) };
        restore.Click += (_, _) =>
        {
            if (MessageBox.Show("Restaurar as permissões e configurações de energia salvas antes da ativação? Isso remove a restrição do CEP Horas.", Title, MessageBoxButton.YesNo, MessageBoxImage.Question) != MessageBoxResult.Yes) return;
            try { PolicyStore.Restore(); status.Text = "RESTAURADO. Faça novo logon dos usuários. O aplicativo pode ser desinstalado normalmente."; }
            catch (Exception error) { status.Text = "A restauração não concluiu. Preserve a instalação e o backup para recuperação: " + error.Message; }
        };
        panel.Children.Add(restore); panel.Children.Add(status);
    }
}
